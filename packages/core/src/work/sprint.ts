import { businessDaysBetween } from './calendar.js';
import type { Sprint, StatusCategory, WorkItem } from './model.js';
import { round } from '../scoring/stats.js';

/**
 * Changes recorded up to this long after the sprint start still count as the starting scope.
 * Trackers record "issues added when the sprint was started" slightly around the start time.
 */
export const START_TOLERANCE_MS = 30_000;

const ms = (iso: string) => new Date(iso).getTime();

/** Whether the item was in the sprint at instant `t` (ms), replaying its sprint history. */
export function inSprintAt(item: WorkItem, sprintId: number, t: number): boolean {
  const id = String(sprintId);
  let member = false;
  for (const change of item.sprintHistory) {
    if (ms(change.at) > t) break;
    if (change.added.includes(id)) member = true;
    if (change.removed.includes(id)) member = false;
  }
  return member;
}

/** Whether the item was ever in the sprint. */
export function everInSprint(item: WorkItem, sprintId: number): boolean {
  const id = String(sprintId);
  return item.sprintHistory.some((c) => c.added.includes(id));
}

/** Status category at instant `t` (ms). Before the first recorded transition the item is `todo`. */
export function categoryAt(item: WorkItem, t: number): StatusCategory {
  if (item.transitions.length === 0) return item.statusCategory;
  let category: StatusCategory = 'todo';
  for (const tr of item.transitions) {
    if (ms(tr.at) > t) break;
    category = tr.toCategory;
  }
  return category;
}

/** The instant a sprint is evaluated at: its completion for a closed sprint, otherwise `now`. */
export function evaluationTime(sprint: Sprint, now: Date): number {
  if (sprint.state === 'closed') {
    const end = sprint.completeDate ?? sprint.endDate;
    if (end) return ms(end);
  }
  return now.getTime();
}

const weight = (item: WorkItem, byEstimate: boolean) => (byEstimate ? (item.estimate?.value ?? 0) : 1);

export interface SprintScope {
  /** In the sprint at the evaluation time. */
  members: WorkItem[];
  /** In the sprint when it started (within START_TOLERANCE_MS). */
  atStart: WorkItem[];
  addedAfterStart: WorkItem[];
  removedAfterStart: WorkItem[];
  /** Members that were also in the previous sprint. */
  carriedOver: WorkItem[];
  /** Weights use estimates when at least one item ever in the sprint has one, else issue counts. */
  byEstimate: boolean;
  evaluatedAt: number;
}

export function sprintScope(
  items: readonly WorkItem[],
  sprint: Sprint,
  now: Date,
  previousSprintId?: number,
): SprintScope {
  const t = evaluationTime(sprint, now);
  const ever = items.filter((i) => everInSprint(i, sprint.id));
  const startCut = sprint.startDate ? ms(sprint.startDate) + START_TOLERANCE_MS : t;
  const members = ever.filter((i) => inSprintAt(i, sprint.id, t));
  const atStart = ever.filter((i) => inSprintAt(i, sprint.id, startCut));
  const startKeys = new Set(atStart.map((i) => i.key));
  const id = String(sprint.id);
  const changedAfterStart = (i: WorkItem, kind: 'added' | 'removed') =>
    i.sprintHistory.some((c) => ms(c.at) > startCut && ms(c.at) <= t && c[kind].includes(id));
  const addedAfterStart = sprint.startDate
    ? ever.filter((i) => !startKeys.has(i.key) && changedAfterStart(i, 'added'))
    : [];
  const removedAfterStart = sprint.startDate ? ever.filter((i) => changedAfterStart(i, 'removed')) : [];
  const carriedOver =
    previousSprintId === undefined ? [] : members.filter((i) => everInSprint(i, previousSprintId));
  return {
    members,
    atStart,
    addedAfterStart,
    removedAfterStart,
    carriedOver,
    byEstimate: ever.some((i) => i.estimate !== null),
    evaluatedAt: t,
  };
}

export interface SprintSummary {
  counts: { total: number; byCategory: Record<StatusCategory, number>; byType: Record<string, number> };
  estimate: { committed: number; completed: number; unit: string; unestimatedCount: number };
}

/** Counts and estimate totals of the sprint's scope at the evaluation time (spec §7.3 get_sprint_issues). */
export function summarizeSprint(scope: SprintScope): SprintSummary {
  const byCategory: Record<StatusCategory, number> = { todo: 0, in_progress: 0, done: 0 };
  const byType: Record<string, number> = {};
  for (const item of scope.members) {
    byCategory[categoryAt(item, scope.evaluatedAt)]++;
    byType[item.type] = (byType[item.type] ?? 0) + 1;
  }
  const unit = scope.byEstimate
    ? (scope.members.find((i) => i.estimate)?.estimate?.unit ?? 'story_points')
    : 'issues';
  const committed = sum(scope.members.map((i) => weight(i, scope.byEstimate)));
  const completed = sum(
    scope.members
      .filter((i) => categoryAt(i, scope.evaluatedAt) === 'done')
      .map((i) => weight(i, scope.byEstimate)),
  );
  return {
    counts: { total: scope.members.length, byCategory, byType: sortKeys(byType) },
    estimate: {
      committed: round(committed, 2),
      completed: round(completed, 2),
      unit,
      unestimatedCount: scope.members.filter((i) => i.estimate === null).length,
    },
  };
}

export function scopeWeight(items: readonly WorkItem[], byEstimate: boolean): number {
  return sum(items.map((i) => weight(i, byEstimate)));
}

/** Share of the sprint's working days that have passed, in percent (100 for a closed sprint). */
export function elapsedPct(sprint: Sprint, evaluatedAt: number): number {
  if (!sprint.startDate || !sprint.endDate) return 0;
  const total = businessDaysBetween(sprint.startDate, sprint.endDate);
  if (total <= 0) return 100;
  const end = Math.min(evaluatedAt, ms(sprint.endDate));
  return round(Math.min(100, (businessDaysBetween(sprint.startDate, new Date(end)) / total) * 100), 1);
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function sortKeys<T>(r: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(r).sort(([a], [b]) => a.localeCompare(b)));
}
