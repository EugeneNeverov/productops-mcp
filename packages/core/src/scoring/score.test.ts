import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FIB_SCALE, IMPACT_SCALE, Initiative } from './model.js';
import { assertComplete, customScores, rank, riceScore, scoreAll, wsjfScore } from './score.js';

const golden = JSON.parse(readFileSync(new URL('./__fixtures__/golden.json', import.meta.url), 'utf8'));
const parse = (raw: object[]) => raw.map((r) => Initiative.parse(r));

describe('RICE golden cases (Python oracle)', () => {
  const items = parse(golden.rice.items);
  const ranked = rank(items.map(riceScore));

  it.each(golden.rice.items as { id: string; score: number }[])('$id scores $score', ({ id, score }) => {
    expect(ranked.find((r) => r.item.id === id)!.score).toBeCloseTo(score, 9);
  });

  it('ranks in the oracle order, including tie-breaks', () => {
    expect(ranked.map((r) => r.item.id)).toEqual(golden.rice.expectedOrder);
    expect(ranked.map((r) => r.rank)).toEqual(ranked.map((_, i) => i + 1));
  });
});

describe('WSJF golden cases (Python oracle)', () => {
  const items = parse(golden.wsjf.items);
  const ranked = rank(items.map(wsjfScore));

  it.each(golden.wsjf.items as { id: string; score: number }[])('$id scores $score', ({ id, score }) => {
    expect(ranked.find((r) => r.item.id === id)!.score).toBeCloseTo(score, 9);
  });

  it('ranks in the oracle order, including tie-breaks', () => {
    expect(ranked.map((r) => r.item.id)).toEqual(golden.wsjf.expectedOrder);
  });
});

describe('incomplete items', () => {
  const items = parse([
    { id: 'a', title: 'a', reach: 1, impact: 1, confidence: 1, effort: 1 },
    { id: 'b', title: 'b', reach: 1, impact: 1 },
  ]);

  it('are ranked after complete ones with rank null', () => {
    const ranked = rank(items.map(riceScore));
    expect(ranked.map((r) => [r.item.id, r.rank])).toEqual([
      ['a', 1],
      ['b', null],
    ]);
    expect(ranked[1]!.missing).toEqual(['confidence', 'effort']);
  });

  it('fail strict validation with every missing field listed', () => {
    expect(() => assertComplete(items.map(riceScore), 'RICE')).toThrow(
      expect.objectContaining({
        code: 'VALIDATION_ERROR',
        details: { issues: [{ id: 'b', missing: ['confidence', 'effort'] }] },
      }),
    );
  });
});

describe('CUSTOM scoring', () => {
  const items = parse([
    { id: 'a', title: 'a', reach: 100, effort: 1 },
    { id: 'b', title: 'b', reach: 0, effort: 5 },
    { id: 'c', title: 'c', reach: 50, effort: 3 },
  ]);

  it('normalizes min-max and inverts lower-is-better fields', () => {
    const s = customScores(items, { weights: { reach: 2, effort: 1 }, invert: ['effort'] });
    expect(s.map((x) => x.score)).toEqual([3, 0, 1.5]);
  });

  it('uses 0.5 when every value is equal', () => {
    const s = customScores(items, { weights: { confidence: 1 }, invert: [] });
    expect(s.every((x) => x.score === null)).toBe(true);
    const same = parse([
      { id: 'x', title: 'x', reach: 7 },
      { id: 'y', title: 'y', reach: 7 },
    ]);
    expect(customScores(same, { weights: { reach: 1 }, invert: [] }).map((x) => x.score)).toEqual([0.5, 0.5]);
  });

  it('rejects unknown fields', () => {
    expect(() => scoreAll('CUSTOM', items, { weights: { title: 1 }, invert: [] })).toThrow(/Unknown fields/);
  });
});

// ── Property-based tests ───────────────────────────────────────────────────────────────

const riceItem = fc.record({
  reach: fc.integer({ min: 0, max: 100_000 }),
  impact: fc.constantFrom(...IMPACT_SCALE),
  confidence: fc.constantFrom(0, 0.1, 0.3, 0.5, 0.8, 1),
  effort: fc.constantFrom(0.25, 0.5, 1, 2, 3, 5, 8, 13),
});
const riceSet = fc.uniqueArray(fc.tuple(fc.stringMatching(/^[a-z]{1,6}$/), riceItem), {
  minLength: 1,
  maxLength: 40,
  selector: ([id]) => id,
});
const toItems = (set: [string, object][]) => set.map(([id, f]) => Initiative.parse({ id, title: id, ...f }));

describe('ranking properties', () => {
  it('does not depend on input order', () => {
    fc.assert(
      fc.property(riceSet, fc.integer(), (set, seed) => {
        const items = toItems(set);
        const shuffled = fc.sample(
          fc.shuffledSubarray(items, { minLength: items.length, maxLength: items.length }),
          { seed, numRuns: 1 },
        )[0]!;
        expect(rank(shuffled.map(riceScore)).map((r) => r.item.id)).toEqual(
          rank(items.map(riceScore)).map((r) => r.item.id),
        );
      }),
    );
  });

  it('never moves an item down when its reach, impact or confidence grows, or effort shrinks', () => {
    fc.assert(
      fc.property(
        riceSet,
        fc.nat(),
        fc.constantFrom('reach', 'impact', 'confidence', 'effort'),
        (set, pick, field) => {
          const items = toItems(set);
          const idx = pick % items.length;
          const before = rank(items.map(riceScore)).find((r) => r.item.id === items[idx]!.id)!.rank!;
          const it = { ...items[idx]! };
          if (field === 'reach') it.reach = it.reach! * 2 + 1;
          if (field === 'impact')
            it.impact = IMPACT_SCALE[Math.min(4, IMPACT_SCALE.indexOf(it.impact!) + 1)]!;
          if (field === 'confidence') it.confidence = Math.min(1, it.confidence! + 0.2);
          if (field === 'effort') it.effort = it.effort! / 2;
          const changed = items.map((x, i) => (i === idx ? it : x));
          const after = rank(changed.map(riceScore)).find((r) => r.item.id === it.id)!.rank!;
          expect(after).toBeLessThanOrEqual(before);
        },
      ),
    );
  });

  it('WSJF never moves an item down when cost of delay grows or job size shrinks', () => {
    const fib = fc.constantFrom(...FIB_SCALE);
    const wsjfSet = fc.uniqueArray(
      fc.tuple(
        fc.stringMatching(/^[a-z]{1,6}$/),
        fc.record({ businessValue: fib, timeCriticality: fib, riskReductionOpportunity: fib, jobSize: fib }),
      ),
      { minLength: 1, maxLength: 30, selector: ([id]) => id },
    );
    fc.assert(
      fc.property(wsjfSet, fc.nat(), (set, pick) => {
        const items = toItems(set);
        const idx = pick % items.length;
        const it = { ...items[idx]! };
        const before = rank(items.map(wsjfScore)).find((r) => r.item.id === it.id)!.rank!;
        it.businessValue = 20;
        it.jobSize = 1;
        const after = rank(items.map((x, i) => (i === idx ? it : x)).map(wsjfScore)).find(
          (r) => r.item.id === it.id,
        )!.rank!;
        expect(after).toBeLessThanOrEqual(before);
      }),
    );
  });
});

describe('output helpers', () => {
  it('rounds scores for output and explains exclusions', async () => {
    const { toScoredItemOut, scoreSummary } = await import('./score.js');
    const items = parse([
      { id: 'a', title: 'a', reach: 1, impact: 1, confidence: 1, effort: 3 },
      { id: 'b', title: 'b', reach: 1 },
    ]);
    const ranked = rank(items.map(riceScore));
    expect(ranked.map(toScoredItemOut)).toEqual([
      {
        id: 'a',
        title: 'a',
        score: 0.3333,
        rank: 1,
        components: { reach: 1, impact: 1, confidence: 1, effort: 3 },
        excluded: false,
      },
      {
        id: 'b',
        title: 'b',
        score: null,
        rank: null,
        components: {},
        excluded: true,
        excludedReason: 'missing: impact, confidence, effort',
      },
    ]);
    expect(scoreSummary(ranked)).toEqual({
      count: 2,
      excludedCount: 1,
      scoreMin: 0.3333,
      scoreMedian: 0.3333,
      scoreMax: 0.3333,
    });
    expect(scoreSummary(rank([riceScore(items[1]!)]))).toMatchObject({ scoreMin: null, scoreMedian: null });
  });

  it('requires weights for CUSTOM', () => {
    expect(() => scoreAll('CUSTOM', [])).toThrow(/custom/);
  });
});
