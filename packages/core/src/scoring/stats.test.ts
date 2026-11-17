import { describe, expect, it } from 'vitest';
import { kendallTau, median, quantile, round } from './stats.js';

describe('stats', () => {
  it('quantile interpolates linearly like numpy', () => {
    expect(quantile([1, 2, 3, 4], 0.25)).toBe(1.75);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([])).toBeNaN();
  });

  it('kendallTau is 1 for equal, −1 for reversed, and matches a hand-computed value', () => {
    const a = new Map([
      ['a', 1],
      ['b', 2],
      ['c', 3],
      ['d', 4],
    ]);
    expect(kendallTau(a, a)).toBe(1);
    expect(
      kendallTau(
        a,
        new Map([
          ['a', 4],
          ['b', 3],
          ['c', 2],
          ['d', 1],
        ]),
      ),
    ).toBe(-1);
    // one swapped pair out of 6 → (5 − 1) / 6
    expect(
      kendallTau(
        a,
        new Map([
          ['a', 2],
          ['b', 1],
          ['c', 3],
          ['d', 4],
        ]),
      ),
    ).toBeCloseTo(4 / 6);
  });

  it('round avoids binary artefacts', () => {
    expect(round(1.00005, 4)).toBe(1.0001);
    expect(round(2 / 3)).toBe(0.6667);
  });
});
