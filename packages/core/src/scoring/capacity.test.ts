import { describe, expect, it } from 'vitest';
import type { Warning } from '../schemas/meta.js';
import { simulateCapacity, type CapacityInput, type Scenario } from './capacity.js';
import { Initiative } from './model.js';

const base: Scenario = {
  name: 'base',
  capacityMultiplier: 1,
  effortMultiplier: 1,
  forceInclude: [],
  forceExclude: [],
};
const mk = (id: string, reach: number, effort: number, extra: object = {}) =>
  Initiative.parse({ id, title: id, reach, impact: 1, confidence: 1, effort, team: 'T', ...extra });

function run(items: Initiative[], capacity: number, overrides: Partial<CapacityInput> = {}) {
  const warnings: Warning[] = [];
  const result = simulateCapacity({
    items,
    rankBy: 'RICE',
    capacity: [{ team: 'T', amount: capacity }],
    scenarios: [base],
    respectDependencies: true,
    warn: (w) => warnings.push(w),
    ...overrides,
  });
  return { ...result, s: result.scenarios[0]!, warnings };
}

describe('simulateCapacity', () => {
  it('takes items greedily by rank and defers the rest for CAPACITY', () => {
    const { s } = run([mk('a', 100, 2), mk('b', 90, 2), mk('c', 10, 1)], 3);
    expect(s.included.map((i) => i.id)).toEqual(['a', 'c']);
    expect(s.deferred).toEqual([{ id: 'b', rank: 2, reason: 'CAPACITY' }]);
    expect(s.utilization.T).toEqual({ used: 3, capacity: 3, pct: 100 });
  });

  it('pulls a lower-ranked dependency in with the item that needs it', () => {
    const { s } = run([mk('a', 100, 1, { dependsOn: ['z'] }), mk('b', 50, 1), mk('z', 1, 1)], 2);
    expect(s.included.map((i) => [i.id, i.via])).toEqual([
      ['a', 'RANK'],
      ['z', 'DEPENDENCY'],
    ]);
    expect(s.deferred[0]).toMatchObject({ id: 'b', reason: 'CAPACITY' });
  });

  it('defers dependents of force-excluded items with reason DEPENDENCY', () => {
    const { s } = run([mk('a', 100, 1, { dependsOn: ['z'] }), mk('z', 1, 1)], 10, {
      scenarios: [{ ...base, forceExclude: ['z'] }],
    });
    expect(s.deferred).toEqual([
      { id: 'a', rank: 1, reason: 'DEPENDENCY', blockedBy: ['z'] },
      { id: 'z', rank: 2, reason: 'FORCED_OUT' },
    ]);
  });

  it('always includes mandatory items and flags over-commitment', () => {
    const { s } = run([mk('a', 100, 1), mk('m', 1, 5, { mandatory: true })], 3);
    expect(s.included.map((i) => [i.id, i.via])).toEqual([['m', 'MANDATORY']]);
    expect(s.overCommitted).toBe(true);
  });

  it('applies scenario multipliers and reports the diff against the first scenario', () => {
    const items = [mk('a', 100, 2), mk('b', 90, 2)];
    const r = run(items, 4, {
      scenarios: [
        base,
        { ...base, name: 'fewer', capacityMultiplier: 0.5 },
        { ...base, name: 'slow', effortMultiplier: 1.5 },
      ],
    });
    expect(r.scenarios.map((x) => x.included.map((i) => i.id))).toEqual([['a', 'b'], ['a'], ['a']]);
    expect(r.diffVsFirst).toEqual([
      { scenario: 'fewer', added: [], removed: ['b'] },
      { scenario: 'slow', added: [], removed: ['b'] },
    ]);
  });

  it('rejects dependency cycles with the cycle path', () => {
    expect(() => run([mk('a', 1, 1, { dependsOn: ['b'] }), mk('b', 1, 1, { dependsOn: ['a'] })], 5)).toThrow(
      expect.objectContaining({ code: 'VALIDATION_ERROR', details: { cycle: ['a', 'b', 'a'] } }),
    );
  });

  it('rejects unknown dependencies, missing effort and conflicting forced choices', () => {
    expect(() => run([mk('a', 1, 1, { dependsOn: ['nope'] })], 5)).toThrow(/unknown initiatives/);
    expect(() =>
      run([Initiative.parse({ id: 'a', title: 'a', reach: 1, impact: 1, confidence: 1 })], 5),
    ).toThrow(/effort/);
    expect(() =>
      run([mk('m', 1, 1, { mandatory: true })], 5, { scenarios: [{ ...base, forceExclude: ['m'] }] }),
    ).toThrow(/mandatory/);
  });

  it('warns and defers items of teams without capacity, unless a shared pool exists', () => {
    const items = [mk('a', 1, 1, { team: 'Other' })];
    const r1 = run(items, 5);
    expect(r1.s.deferred[0]).toMatchObject({ id: 'a', reason: 'CAPACITY' });
    expect(r1.warnings[0]!.code).toBe('NO_CAPACITY_FOR_TEAM');
    const r2 = run(items, 5, { capacity: [{ team: '*', amount: 5 }] });
    expect(r2.s.included[0]).toMatchObject({ id: 'a', team: '*' });
  });

  it('can ignore dependencies', () => {
    const { s } = run([mk('a', 100, 1, { dependsOn: ['z'] }), mk('z', 1, 1)], 1, {
      respectDependencies: false,
    });
    expect(s.included.map((i) => i.id)).toEqual(['a']);
  });
});
