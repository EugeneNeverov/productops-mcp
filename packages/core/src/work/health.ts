import * as z from 'zod/v4';
import { findBlockers } from './blockers.js';
import { cycleStats, cycleTimes, MIN_SAMPLE } from './cycle.js';
import type { Sprint, WorkItem } from './model.js';
import { categoryAt, elapsedPct, scopeWeight, sprintScope, summarizeSprint } from './sprint.js';
import { round } from '../scoring/stats.js';
import type { Warning } from '../schemas/meta.js';

export const CheckId = z.enum([
  'BURNDOWN_LAG',
  'SCOPE_CREEP',
  'BLOCKERS',
  'WIP_OVERLOAD',
  'CYCLE_TIME_REGRESSION',
  'ESTIMATION_GAPS',
  'CARRY_OVER',
]);
export type CheckId = z.infer<typeof CheckId>;

const Threshold = z.object({ warn: z.number(), risk: z.number() });

/** Default thresholds (spec §7.3). Overridable in productops.config.json → jira.health.thresholds. */
export const HealthThresholds = z.object({
  BURNDOWN_LAG: Threshold.default({ warn: 15, risk: 30 }),
  SCOPE_CREEP: Threshold.default({ warn: 10, risk: 25 }),
  BLOCKERS: Threshold.default({ warn: 1, risk: 3 }),
  WIP_OVERLOAD: Threshold.default({ warn: 3, risk: 5 }),
  CYCLE_TIME_REGRESSION: Threshold.default({ warn: 1.25, risk: 1.5 }),
  ESTIMATION_GAPS: Threshold.default({ warn: 10, risk: 25 }),
  CARRY_OVER: Threshold.default({ warn: 10, risk: 25 }),
});
export type HealthThresholds = z.infer<typeof HealthThresholds>;

export const PENALTY = { warn: 7, risk: 15 } as const;

export interface SprintData {
  sprint: Sprint;
  /** Every item that was ever in the sprint, removed ones included. */
  items: WorkItem[];
}

export interface HealthInput {
  current: SprintData;
  /** Closed sprints before the current one, newest first. The first one is the "previous" sprint. */
  baseline: SprintData[];
  now: Date;
  thresholds: HealthThresholds;
  staleDays: number;
  blockedStatuses: readonly string[];
}

export interface HealthCheck {
  id: CheckId;
  status: 'ok' | 'warn' | 'risk';
  value: number | null;
  threshold: { warn: number; risk: number };
  evidence: WorkItem[];
}

export interface HealthResult {
  elapsedPct: number;
  metrics: {
    completionPct: number;
    scopeChangePct: number;
    carryOverFromPrevious: number;
    wip: { current: number; perAssigneeMax: number };
    blockersHigh: number;
    cycleTimeP85VsBaseline: number | null;
    unestimatedPct: number;
  };
  checks: HealthCheck[];
  healthScore: number;
  warnings: Warning[];
}

const pct = (part: number, whole: number) => (whole > 0 ? round((part / whole) * 100, 1) : 0);
const byKey = (a: WorkItem, b: WorkItem) => a.key.localeCompare(b.key, 'en', { numeric: true });

function p85(items: readonly WorkItem[]): number | null {
  const days = cycleTimes(items).records.map((r) => r.days);
  return days.length < MIN_SAMPLE ? null : cycleStats(days, [85]).p['p85']!;
}

/** Composite sprint health (spec §7.3 assess_sprint_health). Pure: same input, same output. */
export function assessSprintHealth(input: HealthInput): HealthResult {
  const { current, baseline, now, thresholds } = input;
  const warnings: Warning[] = [];
  const previous = baseline[0];
  const scope = sprintScope(current.items, current.sprint, now, previous?.sprint.id);
  const summary = summarizeSprint(scope);
  const t = scope.evaluatedAt;
  const evalDate = new Date(t);

  const completionPct = pct(summary.estimate.completed, summary.estimate.committed);
  const startWeight = scopeWeight(scope.atStart, scope.byEstimate);
  const changed = [...scope.addedAfterStart, ...scope.removedAfterStart];
  const scopeChangePct = pct(scopeWeight(changed, scope.byEstimate), startWeight);
  const elapsed = elapsedPct(current.sprint, t);

  const inProgress = scope.members.filter((i) => categoryAt(i, t) === 'in_progress');
  const perAssignee = new Map<string, WorkItem[]>();
  for (const i of inProgress) {
    if (i.assignee === null) continue;
    perAssignee.set(i.assignee, [...(perAssignee.get(i.assignee) ?? []), i]);
  }
  const busiest = [...perAssignee.values()].sort((a, b) => b.length - a.length)[0] ?? [];

  const blockers = findBlockers(scope.members, {
    now: evalDate,
    staleDays: input.staleDays,
    blockedStatuses: input.blockedStatuses,
  });
  const high = blockers.filter((b) => b.severity === 'high');

  const baselineP85 = baseline.map((b) => p85(sprintScope(b.items, b.sprint, now).members));
  const usable = baselineP85.filter((v): v is number => v !== null);
  const currentP85 = p85(scope.members);
  let ratio: number | null = null;
  if (usable.length < baseline.length || usable.length === 0) {
    warnings.push({
      code: 'NO_BASELINE',
      message: `Cycle-time baseline needs ${Math.max(baseline.length, 1)} closed sprint(s) with ≥ ${MIN_SAMPLE} completed items; ${usable.length} available. CYCLE_TIME_REGRESSION is not evaluated.`,
    });
  } else if (currentP85 === null) {
    warnings.push({
      code: 'SMALL_SAMPLE',
      message: `Fewer than ${MIN_SAMPLE} completed items in this sprint; CYCLE_TIME_REGRESSION is not evaluated.`,
    });
  } else {
    const base = usable.reduce((a, b) => a + b, 0) / usable.length;
    ratio = base > 0 ? round(currentP85 / base, 2) : null;
  }
  const slowItems =
    ratio === null
      ? []
      : cycleTimes(scope.members)
          .records.filter((r) => r.days > currentP85!)
          .sort((a, b) => b.days - a.days)
          .map((r) => r.item);

  const unestimated = scope.members.filter((i) => i.estimate === null).sort(byKey);
  const unestimatedPct = pct(unestimated.length, scope.members.length);
  const carryPct = pct(scope.carriedOver.length, scope.atStart.length);
  if (!previous) {
    warnings.push({
      code: 'NO_PREVIOUS_SPRINT',
      message: 'No closed sprint before this one; CARRY_OVER is 0.',
    });
  }

  const notDone = scope.members
    .filter((i) => categoryAt(i, t) !== 'done')
    .sort((a, b) => (b.estimate?.value ?? 0) - (a.estimate?.value ?? 0) || byKey(a, b));

  const check = (id: CheckId, value: number | null, evidence: WorkItem[]): HealthCheck => {
    const threshold = thresholds[id];
    const status =
      value === null ? 'ok' : value >= threshold.risk ? 'risk' : value >= threshold.warn ? 'warn' : 'ok';
    return { id, status, value, threshold, evidence: evidence.slice(0, 10) };
  };
  const checks = [
    check('BURNDOWN_LAG', round(elapsed - completionPct, 1), notDone),
    check('SCOPE_CREEP', scopeChangePct, [...changed].sort(byKey)),
    check(
      'BLOCKERS',
      high.length,
      high.map((b) => b.item),
    ),
    check('WIP_OVERLOAD', busiest.length, [...busiest].sort(byKey)),
    check('CYCLE_TIME_REGRESSION', ratio, slowItems),
    check('ESTIMATION_GAPS', unestimatedPct, unestimated),
    check('CARRY_OVER', carryPct, [...scope.carriedOver].sort(byKey)),
  ];
  const penalty = checks.reduce((s, c) => s + (c.status === 'ok' ? 0 : PENALTY[c.status]), 0);

  return {
    elapsedPct: elapsed,
    metrics: {
      completionPct,
      scopeChangePct,
      carryOverFromPrevious: scope.carriedOver.length,
      wip: { current: inProgress.length, perAssigneeMax: busiest.length },
      blockersHigh: high.length,
      cycleTimeP85VsBaseline: ratio,
      unestimatedPct,
    },
    checks,
    healthScore: Math.max(0, 100 - penalty),
    warnings,
  };
}
