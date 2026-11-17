import { businessDaysBetween } from './calendar.js';
import type { StatusCategory, WorkItem } from './model.js';
import { median, round } from '../scoring/stats.js';

export type BlockerSignal = 'FLAGGED' | 'BLOCKED_BY_OPEN_LINK' | 'STALE_IN_PROGRESS' | 'BLOCKED_STATUS';
export type Severity = 'high' | 'medium' | 'low';

export interface Blocker {
  item: WorkItem;
  statusCategory: StatusCategory;
  signals: BlockerSignal[];
  blockedBy: { key: string; done: boolean }[];
  daysInCurrentStatus: number;
  severity: Severity;
}

export interface BlockerOptions {
  now: Date;
  staleDays: number;
  /** Status names that mean "blocked", compared case-insensitively. */
  blockedStatuses: readonly string[];
}

/** Working days since the item's last transition (or creation when it never moved). */
export function daysInCurrentStatus(item: WorkItem, now: Date): number {
  const last = item.transitions.at(-1)?.at ?? item.createdAt;
  return round(businessDaysBetween(last, now), 2);
}

/**
 * Blocker signals and severity for the not-done items (spec §7.3 find_blockers).
 * high: ≥ 2 signals, or an open blocking link on an item estimated at or above the sprint median;
 * medium: one signal and more than `staleDays` in the current status; low: the rest.
 */
export function findBlockers(items: readonly WorkItem[], opts: BlockerOptions): Blocker[] {
  const blocked = new Set(opts.blockedStatuses.map((s) => s.toLowerCase()));
  const estimates = items.flatMap((i) => (i.estimate ? [i.estimate.value] : []));
  const medianEstimate = estimates.length ? median(estimates) : null;
  const out: Blocker[] = [];
  for (const item of items) {
    if (item.statusCategory === 'done') continue;
    const days = daysInCurrentStatus(item, opts.now);
    const signals: BlockerSignal[] = [];
    if (item.flagged) signals.push('FLAGGED');
    const blockedBy = item.links
      .filter((l) => l.type === 'is_blocked_by')
      .map((l) => ({ key: l.key, done: l.targetDone === true }));
    if (item.links.some((l) => l.type === 'is_blocked_by' && l.targetDone === false)) {
      signals.push('BLOCKED_BY_OPEN_LINK');
    }
    if (item.statusCategory === 'in_progress' && days >= opts.staleDays) signals.push('STALE_IN_PROGRESS');
    if (blocked.has(item.status.toLowerCase())) signals.push('BLOCKED_STATUS');
    if (signals.length === 0) continue;
    const bigOpenLink =
      signals.includes('BLOCKED_BY_OPEN_LINK') &&
      medianEstimate !== null &&
      item.estimate !== null &&
      item.estimate.value >= medianEstimate;
    const severity: Severity =
      signals.length >= 2 || bigOpenLink ? 'high' : days > opts.staleDays ? 'medium' : 'low';
    out.push({
      item,
      statusCategory: item.statusCategory,
      signals,
      blockedBy,
      daysInCurrentStatus: days,
      severity,
    });
  }
  const rank: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
  return out.sort(
    (a, b) =>
      rank[a.severity] - rank[b.severity] ||
      b.signals.length - a.signals.length ||
      b.daysInCurrentStatus - a.daysInCurrentStatus ||
      a.item.key.localeCompare(b.item.key, 'en', { numeric: true }),
  );
}
