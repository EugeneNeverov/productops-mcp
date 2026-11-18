import { describe, expect, it } from 'vitest';
import { ToolFailure } from '../schemas/errors.js';
import { Initiative } from './model.js';
import {
  aggregateTriumvirate,
  buildBrief,
  JUDGE_ROLES,
  JUDGES,
  judgeScore,
  JudgeVerdict,
  type JudgeRole,
} from './triumvirate.js';

const items = ['a', 'b', 'c', 'd'].map((id) =>
  Initiative.parse({ id, title: `Item ${id}`, reach: 100, impact: 1, confidence: 1, effort: 1 }),
);

/** Ratings that give the judge the requested oriented level (1..5) on every criterion. */
const at = (role: JudgeRole, level: number) =>
  Object.fromEntries(JUDGES[role].criteria.map((c) => [c.key, c.higherIsBetter ? level : 6 - level]));

const verdict = (role: JudgeRole, levels: Record<string, number | 'abstain'>) =>
  JudgeVerdict.parse({
    judge: role,
    items: Object.entries(levels).map(([id, l]) =>
      l === 'abstain'
        ? { id, abstain: true, rationale: 'no data' }
        : { id, criteria: at(role, l), confidence: 0.8, rationale: `${role} on ${id}` },
    ),
  });

describe('judgeScore', () => {
  it('maps oriented ratings 1..5 to 0..100 and inverts lower-is-better criteria', () => {
    expect(judgeScore('dev', at('dev', 5))).toBe(100);
    expect(judgeScore('dev', at('dev', 1))).toBe(0);
    expect(judgeScore('dev', { effort: 1, technicalRisk: 1, dependencies: 1, leverage: 5 })).toBe(100);
    expect(judgeScore('product', at('product', 3))).toBe(50);
  });
});

describe('buildBrief', () => {
  it('writes one self-contained brief per judge with only its own criteria', () => {
    const brief = buildBrief(items.slice(0, 2), 'Goal: grow self-serve revenue');
    expect(brief.judges.map((j) => j.role)).toEqual([...JUDGE_ROLES]);
    const dev = brief.judges[0]!;
    expect(dev.instructions).toContain('`effort`');
    expect(dev.instructions).not.toContain('`revenue`');
    expect(dev.instructions).toContain('Goal: grow self-serve revenue');
    expect(dev.instructions).toContain('"id":"a"');
    expect(brief.items[0]).toEqual({
      id: 'a',
      title: 'Item a',
      reach: 100,
      impact: 1,
      confidence: 1,
      effort: 1,
    });
  });
});

describe('aggregateTriumvirate', () => {
  const verdicts = {
    dev: verdict('dev', { a: 5, b: 4, c: 1, d: 'abstain' }),
    business: verdict('business', { a: 4, b: 4, c: 5, d: 3 }),
    product: verdict('product', { a: 5, b: 3, c: 5 }),
  };

  it('ranks agreed items, sends splits to needsDecision and keeps thin items apart', () => {
    const r = aggregateTriumvirate(items, verdicts);
    expect(r.ranking.map((x) => [x.id, x.rank, x.score])).toEqual([
      ['a', 1, 91.67],
      ['b', 2, 66.67],
    ]);
    expect(r.needsDecision).toHaveLength(1);
    const split = r.needsDecision[0]!;
    expect(split).toMatchObject({ id: 'c', spread: 100, highest: 'business', lowest: 'dev' });
    expect(split.opinions.find((o) => o.judge === 'dev')!.pulls).toContainEqual({
      criterion: 'effort',
      value: 5,
      direction: 'against',
    });
    expect(r.insufficient).toEqual([
      {
        id: 'd',
        title: 'Item d',
        scoredBy: ['business'],
        reasons: { dev: 'no data', product: 'not scored' },
      },
    ]);
    expect(r.judges.product.missing).toEqual(['d']);
    expect(r.judges.dev).toMatchObject({ scored: 3, abstained: 1 });
  });

  it('applies weights and the split threshold', () => {
    const r = aggregateTriumvirate(items, verdicts, { weights: { dev: 0 }, splitThreshold: 101 });
    expect(r.needsDecision).toEqual([]);
    expect(r.ranking[0]).toMatchObject({ id: 'c', score: 100 });
  });

  it('reports pairwise agreement between judges', () => {
    const r = aggregateTriumvirate(items, verdicts);
    const devBiz = r.agreement.pairs.find((p) => p.a === 'dev' && p.b === 'business')!;
    expect(devBiz.items).toBe(3);
    expect(devBiz.kendallTau).toBeLessThan(0);
    expect(r.agreement.kendallTau).not.toBeNull();
  });

  it('rejects verdicts that do not match the brief', () => {
    const bad = {
      ...verdicts,
      dev: JudgeVerdict.parse({ judge: 'business', items: [{ id: 'zzz', criteria: { revenue: 3 } }] }),
    };
    try {
      aggregateTriumvirate(items, bad);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ToolFailure);
      const issues = (err as ToolFailure).details!.issues as string[];
      expect(issues.join('\n')).toMatch(
        /another judge[\s\S]*unknown id zzz[\s\S]*missing effort[\s\S]*unknown criteria revenue/,
      );
    }
    expect(() =>
      aggregateTriumvirate(items, verdicts, { weights: { dev: 0, business: 0, product: 0 } }),
    ).toThrow(ToolFailure);
  });

  it('is independent of the order the judges listed items in', () => {
    const reversed = {
      ...verdicts,
      business: { ...verdicts.business, items: [...verdicts.business.items].reverse() },
    };
    expect(aggregateTriumvirate(items, reversed)).toEqual(aggregateTriumvirate(items, verdicts));
  });
});
