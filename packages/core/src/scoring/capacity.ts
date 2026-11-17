import { ToolFailure } from '../schemas/errors.js';
import type { Warning } from '../schemas/meta.js';
import type { Initiative } from './model.js';
import { round } from './stats.js';
import { assertComplete, rank, scoreAll, type CustomWeights, type ScoringMethod } from './score.js';

export interface CapacityEntry {
  team: string;
  amount: number;
}

export interface Scenario {
  name: string;
  capacityMultiplier: number;
  effortMultiplier: number;
  forceInclude: string[];
  forceExclude: string[];
}

export type DeferReason = 'CAPACITY' | 'DEPENDENCY' | 'FORCED_OUT';

export interface ScenarioResult {
  name: string;
  includedCount: number;
  deferredCount: number;
  included: {
    id: string;
    rank: number;
    effort: number;
    team: string;
    via: 'MANDATORY' | 'FORCED' | 'RANK' | 'DEPENDENCY';
  }[];
  deferred: { id: string; rank: number; reason: DeferReason; blockedBy?: string[] }[];
  utilization: Record<string, { used: number; capacity: number; pct: number | null }>;
  totalScoreIncluded: number | null;
  overCommitted: boolean;
}

export interface CapacityInput {
  items: readonly Initiative[];
  rankBy: ScoringMethod | 'INPUT_ORDER';
  custom?: CustomWeights;
  capacity: readonly CapacityEntry[];
  scenarios: readonly Scenario[];
  respectDependencies: boolean;
  warn(w: Warning): void;
}

const SHARED = '*';

/**
 * Greedy, explainable capacity simulation (docs/algorithms.md §4).
 * Ranking is computed once; scenarios change only capacity, effort and forced choices.
 */
export function simulateCapacity(input: CapacityInput): {
  scenarios: ScenarioResult[];
  diffVsFirst: { scenario: string; added: string[]; removed: string[] }[];
} {
  const { items } = input;
  const byId = new Map(items.map((i) => [i.id, i]));

  const noEffort = items.filter((i) => i.effort === undefined).map((i) => i.id);
  if (noEffort.length > 0) {
    throw new ToolFailure('VALIDATION_ERROR', 'Capacity simulation needs "effort" on every initiative.', {
      details: { missingEffort: noEffort },
    });
  }
  if (input.respectDependencies) validateGraph(items, byId);

  // Ranking
  let order: { id: string; rank: number; score: number | null }[];
  if (input.rankBy === 'INPUT_ORDER') {
    order = items.map((i, idx) => ({ id: i.id, rank: idx + 1, score: null }));
  } else {
    const scores = scoreAll(input.rankBy, items, input.custom);
    assertComplete(scores, input.rankBy);
    order = rank(scores).map((r) => ({ id: r.item.id, rank: r.rank!, score: r.score }));
  }
  const rankOf = new Map(order.map((o) => [o.id, o.rank]));
  const scoreOf = new Map(order.map((o) => [o.id, o.score]));

  const capacityKeys = new Set(input.capacity.map((c) => c.team));
  const teamsWithoutCapacity = new Set<string>();
  const poolOf = (item: Initiative): string | undefined => {
    if (item.team !== undefined && capacityKeys.has(item.team)) return item.team;
    if (capacityKeys.has(SHARED)) return SHARED;
    teamsWithoutCapacity.add(item.team ?? '(none)');
    return undefined;
  };

  const results = input.scenarios.map((scenario) => {
    for (const id of [...scenario.forceInclude, ...scenario.forceExclude]) {
      if (!byId.has(id))
        throw new ToolFailure(
          'VALIDATION_ERROR',
          `Scenario "${scenario.name}" refers to unknown id "${id}".`,
        );
    }
    const forcedOut = new Set(scenario.forceExclude);
    const conflict = items.filter(
      (i) => forcedOut.has(i.id) && (i.mandatory || scenario.forceInclude.includes(i.id)),
    );
    if (conflict.length > 0) {
      throw new ToolFailure(
        'VALIDATION_ERROR',
        `Scenario "${scenario.name}" excludes mandatory or force-included items.`,
        {
          details: { ids: conflict.map((c) => c.id) },
        },
      );
    }

    const remaining = new Map<string, number>();
    const capacityTotal = new Map<string, number>();
    for (const c of input.capacity) {
      const amount = (capacityTotal.get(c.team) ?? 0) + c.amount * scenario.capacityMultiplier;
      capacityTotal.set(c.team, amount);
      remaining.set(c.team, amount);
    }
    const effortOf = (i: Initiative) => i.effort! * scenario.effortMultiplier;
    const included = new Map<string, ScenarioResult['included'][number]>();
    const deferred: ScenarioResult['deferred'] = [];
    let overCommitted = false;

    /** Not-yet-included transitive dependencies plus the item itself, dependencies first. */
    const bundleFor = (id: string): string[] => {
      const out: string[] = [];
      const visit = (cur: string) => {
        if (included.has(cur) || out.includes(cur)) return;
        if (input.respectDependencies) for (const d of [...byId.get(cur)!.dependsOn].sort()) visit(d);
        out.push(cur);
      };
      visit(id);
      return out;
    };
    const demand = (bundle: string[]) => {
      const need = new Map<string, number>();
      for (const id of bundle) {
        const pool = poolOf(byId.get(id)!);
        if (pool === undefined) return undefined;
        need.set(pool, (need.get(pool) ?? 0) + effortOf(byId.get(id)!));
      }
      return need;
    };
    const take = (bundle: string[], root: string, via: 'MANDATORY' | 'FORCED' | 'RANK') => {
      for (const id of bundle) {
        const item = byId.get(id)!;
        const pool = poolOf(item)!;
        remaining.set(pool, remaining.get(pool)! - effortOf(item));
        included.set(id, {
          id,
          rank: rankOf.get(id)!,
          effort: round(effortOf(item)),
          team: pool,
          via: id === root ? via : 'DEPENDENCY',
        });
      }
    };

    // 1. Mandatory and forced items with their dependencies, even if that over-commits.
    const pinned = order.filter((o) => byId.get(o.id)!.mandatory || scenario.forceInclude.includes(o.id));
    for (const o of pinned) {
      const bundle = bundleFor(o.id);
      const blocked = bundle.filter((id) => forcedOut.has(id));
      if (blocked.length > 0) {
        throw new ToolFailure(
          'VALIDATION_ERROR',
          `Scenario "${scenario.name}": "${o.id}" depends on force-excluded items.`,
          {
            details: { blockedBy: blocked },
          },
        );
      }
      const need = demand(bundle);
      if (need === undefined) {
        deferred.push({ id: o.id, rank: o.rank, reason: 'CAPACITY' });
        continue;
      }
      take(bundle, o.id, byId.get(o.id)!.mandatory ? 'MANDATORY' : 'FORCED');
    }
    for (const v of remaining.values()) if (v < -1e-9) overCommitted = true;

    // 2. Everything else, greedily by rank, pulling in missing dependencies as one bundle.
    for (const o of order) {
      if (included.has(o.id) || deferred.some((d) => d.id === o.id)) continue;
      if (forcedOut.has(o.id)) {
        deferred.push({ id: o.id, rank: o.rank, reason: 'FORCED_OUT' });
        continue;
      }
      const bundle = bundleFor(o.id);
      const blockedBy = bundle.filter(
        (id) =>
          id !== o.id && (forcedOut.has(id) || deferred.some((d) => d.id === id && d.reason !== 'CAPACITY')),
      );
      if (blockedBy.length > 0) {
        deferred.push({ id: o.id, rank: o.rank, reason: 'DEPENDENCY', blockedBy });
        continue;
      }
      const need = demand(bundle);
      const fits =
        need !== undefined && [...need].every(([pool, amount]) => amount <= remaining.get(pool)! + 1e-9);
      if (fits) take(bundle, o.id, 'RANK');
      else {
        const deps = bundle.filter((id) => id !== o.id);
        deferred.push({
          id: o.id,
          rank: o.rank,
          reason: 'CAPACITY',
          ...(deps.length ? { blockedBy: deps } : {}),
        });
      }
    }

    const utilization: ScenarioResult['utilization'] = {};
    for (const [pool, cap] of [...capacityTotal].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const used = cap - remaining.get(pool)!;
      utilization[pool] = {
        used: round(used),
        capacity: round(cap),
        pct: cap === 0 ? null : round((used / cap) * 100, 2),
      };
    }
    const inc = [...included.values()].sort((a, b) => a.rank - b.rank);
    const totalScore =
      input.rankBy === 'INPUT_ORDER' ? null : round(inc.reduce((s, i) => s + (scoreOf.get(i.id) ?? 0), 0));
    return {
      name: scenario.name,
      includedCount: inc.length,
      deferredCount: deferred.length,
      included: inc,
      deferred: deferred.sort((a, b) => a.rank - b.rank),
      utilization,
      totalScoreIncluded: totalScore,
      overCommitted,
    } satisfies ScenarioResult;
  });

  if (teamsWithoutCapacity.size > 0) {
    input.warn({
      code: 'NO_CAPACITY_FOR_TEAM',
      message: `No capacity entry (and no "*" pool) for: ${[...teamsWithoutCapacity].sort().join(', ')}. Their items were deferred.`,
    });
  }

  const first = new Set(results[0]!.included.map((i) => i.id));
  const diffVsFirst = results.slice(1).map((r) => {
    const ids = new Set(r.included.map((i) => i.id));
    return {
      scenario: r.name,
      added: [...ids].filter((id) => !first.has(id)).sort(),
      removed: [...first].filter((id) => !ids.has(id)).sort(),
    };
  });
  return { scenarios: results, diffVsFirst };
}

function validateGraph(items: readonly Initiative[], byId: Map<string, Initiative>): void {
  const unknown = items.flatMap((i) =>
    i.dependsOn.filter((d) => !byId.has(d)).map((d) => ({ id: i.id, dependsOn: d })),
  );
  if (unknown.length > 0) {
    throw new ToolFailure('VALIDATION_ERROR', 'dependsOn refers to unknown initiatives.', {
      details: { unknown },
    });
  }
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];
  const visit = (id: string) => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'visiting') {
      const cycle = [...stack.slice(stack.indexOf(id)), id];
      throw new ToolFailure('VALIDATION_ERROR', `Dependency cycle: ${cycle.join(' → ')}`, {
        details: { cycle },
      });
    }
    state.set(id, 'visiting');
    stack.push(id);
    for (const d of byId.get(id)!.dependsOn) visit(d);
    stack.pop();
    state.set(id, 'done');
  };
  for (const i of [...items].sort((a, b) => (a.id < b.id ? -1 : 1))) visit(i.id);
}
