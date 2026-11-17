import { businessDaysBetween } from './calendar.js';
import type { WorkItem } from './model.js';
import { median, quantile, round } from '../scoring/stats.js';

export const MIN_SAMPLE = 5;

export interface CycleRecord {
  item: WorkItem;
  /** Working days from the first move into in_progress to the last move into done. */
  days: number;
  reopened: boolean;
  /** Working days per status between start and finish. */
  inStatus: Record<string, number>;
}

export interface CycleStats {
  count: number;
  p: Record<string, number | null>;
  mean: number | null;
  max: number | null;
}

export interface CycleAnalysis {
  population: { completed: number; excludedNoStart: number; reopened: number };
  records: CycleRecord[];
}

/**
 * Cycle time per completed item (definitions in docs/metrics.md): start = first transition into
 * `in_progress`, finish = last transition into `done`. Items that never started are excluded;
 * reopened items count once, with their last done.
 */
export function cycleTimes(items: readonly WorkItem[]): CycleAnalysis {
  const records: CycleRecord[] = [];
  let excludedNoStart = 0;
  let reopened = 0;
  for (const item of items) {
    if (item.statusCategory !== 'done') continue;
    const tr = item.transitions;
    const startIdx = tr.findIndex((t) => t.toCategory === 'in_progress');
    let endIdx = -1;
    for (let i = tr.length - 1; i >= 0; i--) {
      if (tr[i]!.toCategory === 'done') {
        endIdx = i;
        break;
      }
    }
    if (endIdx < 0) continue;
    if (startIdx < 0 || startIdx > endIdx) {
      excludedNoStart++;
      continue;
    }
    const wasReopened = tr.slice(0, endIdx).some((t) => t.toCategory === 'done');
    if (wasReopened) reopened++;
    const inStatus: Record<string, number> = {};
    for (let i = startIdx; i < endIdx; i++) {
      const d = businessDaysBetween(tr[i]!.at, tr[i + 1]!.at);
      inStatus[tr[i]!.to] = (inStatus[tr[i]!.to] ?? 0) + d;
    }
    records.push({
      item,
      days: businessDaysBetween(tr[startIdx]!.at, tr[endIdx]!.at),
      reopened: wasReopened,
      inStatus,
    });
  }
  records.sort((a, b) => a.item.key.localeCompare(b.item.key, 'en', { numeric: true }));
  return { population: { completed: records.length, excludedNoStart, reopened }, records };
}

/** Percentile stats; percentiles are null when the sample is smaller than MIN_SAMPLE. */
export function cycleStats(days: readonly number[], percentiles: readonly number[]): CycleStats {
  const small = days.length < MIN_SAMPLE;
  const p: Record<string, number | null> = {};
  for (const pct of percentiles) p[`p${pct}`] = small ? null : round(quantile(days, pct / 100), 2);
  return {
    count: days.length,
    p,
    mean: days.length ? round(days.reduce((a, b) => a + b, 0) / days.length, 2) : null,
    max: days.length ? round(Math.max(...days), 2) : null,
  };
}

export function timeInStatus(records: readonly CycleRecord[]) {
  const per = new Map<string, number[]>();
  let total = 0;
  for (const r of records) {
    for (const [status, d] of Object.entries(r.inStatus)) {
      if (!per.has(status)) per.set(status, []);
      per.get(status)!.push(d);
      total += d;
    }
  }
  return [...per.entries()]
    .map(([status, ds]) => ({
      status,
      medianDays: round(median(ds), 2),
      sharePct: total > 0 ? round((ds.reduce((a, b) => a + b, 0) / total) * 100, 1) : 0,
    }))
    .sort((a, b) => b.sharePct - a.sharePct || a.status.localeCompare(b.status));
}
