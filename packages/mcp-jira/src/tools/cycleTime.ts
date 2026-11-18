import * as z from 'zod/v4';
import {
  categoryAt,
  cycleStats,
  cycleTimes,
  Meta,
  MIN_SAMPLE,
  quantile,
  round,
  sprintScope,
  timeInStatus,
  ToolFailure,
  type ToolContext,
  type WorkItem,
} from '@productops-mcp/core';
import { lastClosed, Refresh, withSession, type JiraEnv } from './common.js';

const MAX_WINDOW_DAYS = 180;

export const AnalyzeCycleTimeInput = z.object({
  boardId: z.number().int(),
  window: z
    .union([
      z.object({ lastSprints: z.number().int().min(1).max(12) }),
      z.object({ from: z.iso.date(), to: z.iso.date() }).describe(`At most ${MAX_WINDOW_DAYS} days`),
    ])
    .default({ lastSprints: 3 }),
  startStatusCategory: z.literal('in_progress').default('in_progress'),
  groupBy: z.enum(['none', 'type', 'assignee']).default('type'),
  percentiles: z.array(z.number().int().min(1).max(99)).min(1).max(5).default([50, 85, 95]),
  refresh: Refresh,
});
export type AnalyzeCycleTimeInput = z.infer<typeof AnalyzeCycleTimeInput>;

const CycleStatsOut = z.object({
  count: z.number().int(),
  p: z.record(z.string(), z.number().nullable()),
  mean: z.number().nullable(),
  max: z.number().nullable(),
});

export const AnalyzeCycleTimeOutput = z.object({
  window: z.object({
    from: z.string().nullable(),
    to: z.string().nullable(),
    sprints: z.array(z.number().int()),
  }),
  population: z.object({
    completed: z.number().int(),
    excludedNoStart: z.number().int(),
    reopened: z.number().int(),
  }),
  overall: CycleStatsOut,
  groups: z.array(z.object({ key: z.string(), stats: CycleStatsOut })),
  timeInStatus: z.array(z.object({ status: z.string(), medianDays: z.number(), sharePct: z.number() })),
  outliers: z.array(z.object({ key: z.string(), url: z.string().url(), days: z.number() })).max(10),
  meta: Meta,
});

export const analyzeCycleTimeDescription =
  'Cycle time of completed issues in working days: from the first move into In Progress to the last move into Done. ' +
  'Percentiles overall and per group, time per status, and outliers above p95. Groups under 5 items get no percentiles.';

export function createAnalyzeCycleTimeHandler(env: JiraEnv) {
  return async (input: AnalyzeCycleTimeInput, ctx: ToolContext) => {
    const now = env.source.now();
    const { result, source } = await withSession(
      env,
      ctx,
      async (session) => {
        if ('lastSprints' in input.window) {
          const sprints = await env.source.sprints(input.boardId, session);
          const picked = lastClosed(sprints, input.window.lastSprints);
          if (picked.length === 0) {
            ctx.warn({
              code: 'NO_CLOSED_SPRINTS',
              message: `Board ${input.boardId} has no closed sprint yet, so there is no completed work to measure. Use a from/to window instead.`,
            });
          }
          const byKey = new Map<string, WorkItem>();
          for (const s of picked) {
            const scope = sprintScope(await env.source.sprintItems(input.boardId, s.id, session), s, now);
            for (const i of scope.members)
              if (categoryAt(i, scope.evaluatedAt) === 'done') byKey.set(i.key, i);
          }
          const starts = picked.map((s) => s.startDate ?? '').sort();
          const ends = picked.map((s) => s.completeDate ?? s.endDate ?? '').sort();
          return {
            items: [...byKey.values()],
            window: {
              from: starts[0] || null,
              to: ends.at(-1) || null,
              sprints: picked.map((s) => s.id).sort((a, b) => a - b),
            },
          };
        }
        const from = new Date(`${input.window.from}T00:00:00.000Z`);
        const to = new Date(new Date(`${input.window.to}T00:00:00.000Z`).getTime() + 86_400_000);
        const days = (to.getTime() - from.getTime()) / 86_400_000;
        if (days <= 0 || days > MAX_WINDOW_DAYS + 1) {
          throw new ToolFailure(
            'VALIDATION_ERROR',
            `window must cover 1–${MAX_WINDOW_DAYS} days, from ≤ to.`,
          );
        }
        return {
          items: await env.source.completedItems(input.boardId, from, to, session),
          window: { from: input.window.from, to: input.window.to, sprints: [] },
        };
      },
      { refresh: input.refresh },
    );

    const { records, population } = cycleTimes(result.items);
    const days = records.map((r) => r.days);
    const overall = cycleStats(days, input.percentiles);
    if (records.length < MIN_SAMPLE) {
      ctx.warn({
        code: 'SMALL_SAMPLE',
        message: `Only ${records.length} completed item(s); percentiles are not computed.`,
      });
    }
    const groupKey = (i: WorkItem) =>
      input.groupBy === 'type' ? i.type : input.groupBy === 'assignee' ? (i.assignee ?? 'unassigned') : 'all';
    const groups =
      input.groupBy === 'none'
        ? []
        : [...new Set(records.map((r) => groupKey(r.item)))].sort().map((key) => {
            const ds = records.filter((r) => groupKey(r.item) === key).map((r) => r.days);
            return { key, stats: cycleStats(ds, input.percentiles) };
          });
    const small = groups.filter((g) => g.stats.count < MIN_SAMPLE).map((g) => g.key);
    if (small.length && records.length >= MIN_SAMPLE) {
      ctx.warn({
        code: 'SMALL_SAMPLE',
        message: `Groups with fewer than ${MIN_SAMPLE} items have no percentiles.`,
        itemIds: small,
      });
    }
    const p95 = records.length >= MIN_SAMPLE ? quantile(days, 0.95) : Infinity;
    const outliers = records
      .filter((r) => r.days > p95)
      .sort((a, b) => b.days - a.days)
      .slice(0, 10)
      .map((r) => ({ key: r.item.key, url: r.item.url, days: round(r.days, 2) }));
    const tis = timeInStatus(records);
    const pText = Object.entries(overall.p)
      .map(([k, v]) => `${k} ${v ?? 'n/a'}`)
      .join(', ');
    return {
      data: { window: result.window, population, overall, groups, timeInStatus: tis, outliers },
      summary:
        `Cycle time of ${population.completed} completed item(s), working days: ${pText}. ` +
        `${population.excludedNoStart} never started, ${population.reopened} reopened. ` +
        (tis[0] ? `Most time in "${tis[0].status}" (${tis[0].sharePct}%).` : ''),
      source,
    };
  };
}
