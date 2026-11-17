import { describe, expect, it } from 'vitest';
import { compareRankings } from './compare.js';
import { Initiative } from './model.js';

const mk = (id: string, f: object) =>
  Initiative.parse({
    id,
    title: id,
    reach: 100,
    impact: 1,
    confidence: 1,
    effort: 1,
    businessValue: 5,
    timeCriticality: 5,
    riskReductionOpportunity: 5,
    jobSize: 5,
    ...f,
  });

describe('compareRankings', () => {
  it('finds an item that RICE loves and WSJF does not', () => {
    const items = [
      mk('big-reach', {
        reach: 10_000,
        businessValue: 1,
        timeCriticality: 1,
        riskReductionOpportunity: 1,
        jobSize: 20,
      }),
      ...Array.from({ length: 9 }, (_, i) => mk(`m${i}`, { reach: 100 + i, businessValue: 8 })),
    ];
    const r = compareRankings(items, ['RICE', 'WSJF'], 3);
    expect(r.rankings.RICE![0]!.id).toBe('big-reach');
    expect(r.rankings.WSJF!.at(-1)!.id).toBe('big-reach');
    expect(r.disagreements[0]).toMatchObject({ id: 'big-reach', ranks: { RICE: 1, WSJF: 10 } });
    expect(r.disagreements[0]!.drivers).toEqual(
      expect.arrayContaining(['HIGH_REACH', 'LOW_BUSINESS_VALUE', 'HIGH_JOB_SIZE']),
    );
    expect(r.consensusTop).not.toContain('big-reach');
  });

  it('leaves out items that a method cannot score and reports them', () => {
    const items = [
      mk('a', {}),
      mk('b', { reach: 5 }),
      Initiative.parse({ id: 'c', title: 'c', reach: 1, impact: 1, confidence: 1, effort: 1 }),
    ];
    const r = compareRankings(items, ['RICE', 'WSJF'], 10);
    expect(r.excluded).toEqual(['c']);
    expect(r.rankings.RICE!.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('reports perfect agreement for identical methods', () => {
    const items = Array.from({ length: 6 }, (_, i) => mk(`x${i}`, { reach: i * 10 }));
    const r = compareRankings(items, ['RICE', 'CUSTOM'], 3, { weights: { reach: 1 }, invert: [] });
    expect(r.agreement.kendallTau).toBe(1);
    expect(r.agreement.topNOverlap).toBe(1);
    expect(r.disagreements).toEqual([]);
  });
});
