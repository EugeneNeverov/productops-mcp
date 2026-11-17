import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { explainRanking } from './explain.js';
import { IMPACT_SCALE, Initiative } from './model.js';
import { rank, riceScore } from './score.js';

const mk = (id: string, f: object) =>
  Initiative.parse({ id, title: id, reach: 100, impact: 1, confidence: 0.8, effort: 2, ...f });

describe('explainRanking', () => {
  const items = [
    mk('a', { reach: 1000 }),
    mk('b', { reach: 500 }),
    mk('c', { reach: 480 }),
    mk('d', { reach: 10, confidence: 0.3 }),
  ];

  it('decomposes the score against the set median', () => {
    const [e] = explainRanking(items, 'RICE', ['a'], 'none');
    const reach = e!.contributions.find((c) => c.component === 'reach')!;
    expect(reach.vsMedian).toBeCloseTo(Math.log(1000 / 490), 4);
    expect(e!.sensitivity).toEqual([]);
  });

  it('flags near ties and low confidence', () => {
    const [b, d] = explainRanking(items, 'RICE', ['b', 'd'], 'neighbors');
    expect(b!.flags).toContain('NEAR_TIE');
    expect(d!.flags).toContain('LOW_CONFIDENCE');
  });

  it('returns null when no single change can overtake (confidence capped at 1)', () => {
    const two = [mk('top', { reach: 10_000, confidence: 1 }), mk('low', { reach: 10, confidence: 0.5 })];
    const [e] = explainRanking(two, 'RICE', ['low'], 'neighbors');
    expect(e!.sensitivity.find((s) => s.component === 'confidence')!.toOvertake).toBeNull();
    expect(e!.sensitivity.find((s) => s.component === 'reach')!.toOvertake).toMatchObject({
      targetId: 'top',
    });
  });

  it('rejects unknown ids', () => {
    expect(() => explainRanking(items, 'RICE', ['zzz'], 'none')).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
  });

  it('every reported change really moves the rank (property)', () => {
    const set = fc.uniqueArray(
      fc.tuple(
        fc.stringMatching(/^[a-z]{1,5}$/),
        fc.record({
          reach: fc.integer({ min: 1, max: 10_000 }),
          impact: fc.constantFrom(...IMPACT_SCALE),
          confidence: fc.constantFrom(0.3, 0.5, 0.8),
          effort: fc.constantFrom(0.5, 1, 2, 5, 8),
        }),
      ),
      { minLength: 3, maxLength: 15, selector: ([id]) => id },
    );
    fc.assert(
      fc.property(set, fc.nat(), (raw, pick) => {
        const all = raw.map(([id, f]) => Initiative.parse({ id, title: id, ...f }));
        const target = all[pick % all.length]!;
        const [e] = explainRanking(all, 'RICE', [target.id], 'neighbors');
        for (const s of e!.sensitivity) {
          for (const [change, dir] of [
            [s.toOvertake, 'up'],
            [s.toBeOvertaken, 'down'],
          ] as const) {
            if (!change) continue;
            const value = 'requiredValue' in change ? change.requiredValue : change.thresholdValue;
            const changed = all.map((x) => (x.id === target.id ? { ...x, [s.component]: value } : x));
            const newRank = rank(changed.map(riceScore)).find((r) => r.item.id === target.id)!.rank!;
            if (dir === 'up') expect(newRank).toBeLessThan(e!.rank);
            else expect(newRank).toBeGreaterThan(e!.rank);
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});

describe('explainRanking with WSJF', () => {
  const w = (id: string, bv: number, tc: number, rr: number, js: number) =>
    Initiative.parse({
      id,
      title: id,
      businessValue: bv,
      timeCriticality: tc,
      riskReductionOpportunity: rr,
      jobSize: js,
    });
  const items = [w('a', 20, 13, 8, 3), w('b', 8, 5, 3, 5), w('c', 5, 3, 2, 8), w('d', 3, 2, 1, 20)];

  it('splits cost of delay and finds scale steps that change the rank', () => {
    const [b] = explainRanking(items, 'WSJF', ['b'], 'neighbors');
    expect(b!.costOfDelayBreakdown).toEqual({
      businessValue: 0.5,
      timeCriticality: 0.3125,
      riskReductionOpportunity: 0.1875,
    });
    expect(b!.contributions.map((c) => c.component)).toEqual(['costOfDelay', 'jobSize']);
    const js = b!.sensitivity.find((s) => s.component === 'jobSize')!;
    expect(js.toOvertake).toMatchObject({ targetId: 'a', requiredValue: 1 });
    expect(js.toBeOvertaken).toMatchObject({ byId: 'c', thresholdValue: 13 });
  });

  it('compares with the top item and flags job-size outliers', () => {
    const many = [...items, w('e', 3, 3, 3, 3), w('f', 2, 2, 2, 2), w('g', 1, 1, 1, 1)];
    const [d] = explainRanking(many, 'WSJF', ['d'], 'top1');
    expect(d!.sensitivity.every((s) => s.toBeOvertaken === null)).toBe(true);
    expect(d!.sensitivity.find((s) => s.component === 'jobSize')!.toOvertake).toBeNull();
    expect(d!.flags).toContain('HIGH_EFFORT_OUTLIER');
    const [a] = explainRanking(many, 'WSJF', ['a'], 'top1');
    expect(a!.sensitivity.every((s) => s.toOvertake === null)).toBe(true);
  });
});
