import * as z from 'zod/v4';
import { assessSprintHealth, CheckId, Meta, type SprintData, type ToolContext } from '@productops-mcp/core';
import {
  Evidence,
  evidence,
  lastClosed,
  Refresh,
  resolveSprint,
  SprintInfo,
  sprintInfo,
  SprintSelector,
  withSession,
  type JiraEnv,
} from './common.js';

export const AssessSprintHealthInput = z.object({
  boardId: z.number().int(),
  sprint: SprintSelector,
  baselineSprints: z
    .number()
    .int()
    .min(1)
    .max(6)
    .default(3)
    .describe('Closed sprints before this one used for the cycle-time baseline'),
  refresh: Refresh,
});
export type AssessSprintHealthInput = z.infer<typeof AssessSprintHealthInput>;

export const AssessSprintHealthOutput = z.object({
  sprint: SprintInfo,
  elapsedPct: z.number(),
  metrics: z.object({
    completionPct: z.number(),
    scopeChangePct: z.number(),
    carryOverFromPrevious: z.number().int(),
    wip: z.object({ current: z.number().int(), perAssigneeMax: z.number().int() }),
    blockersHigh: z.number().int(),
    cycleTimeP85VsBaseline: z.number().nullable(),
    unestimatedPct: z.number(),
  }),
  checks: z.array(
    z.object({
      id: CheckId,
      status: z.enum(['ok', 'warn', 'risk']),
      value: z.number().nullable(),
      threshold: z.object({ warn: z.number(), risk: z.number() }),
      evidence: z.array(Evidence).max(10),
    }),
  ),
  healthScore: z.number().int().min(0).max(100),
  meta: Meta,
});

export const assessSprintHealthDescription =
  'One-call sprint health check: burndown lag, scope change, blockers, WIP per person, cycle-time regression against ' +
  'the previous sprints, estimation gaps and carry-over. Each check has a value, its warn/risk thresholds and evidence ' +
  'issues; healthScore = 100 − 7 per warn − 15 per risk.';

export function createAssessSprintHealthHandler(env: JiraEnv) {
  return async (input: AssessSprintHealthInput, ctx: ToolContext) => {
    const { result, source } = await withSession(
      env,
      ctx,
      async (session) => {
        const sprints = await env.source.sprints(input.boardId, session);
        const sprint = resolveSprint(sprints, input.sprint, input.boardId);
        const current: SprintData = {
          sprint,
          items: await env.source.sprintItems(input.boardId, sprint.id, session),
        };
        const baseline: SprintData[] = [];
        for (const s of lastClosed(sprints, input.baselineSprints, sprint)) {
          baseline.push({ sprint: s, items: await env.source.sprintItems(input.boardId, s.id, session) });
        }
        return { sprint, current, baseline };
      },
      { refresh: input.refresh },
    );
    const health = assessSprintHealth({
      current: result.current,
      baseline: result.baseline,
      now: env.source.now(),
      thresholds: env.config.health.thresholds,
      staleDays: 3,
      blockedStatuses: env.config.blockedStatuses,
    });
    for (const w of health.warnings) ctx.warn(w);
    const checks = health.checks.map((c) => ({ ...c, evidence: evidence(c.evidence) }));
    const flagged = checks.filter((c) => c.status !== 'ok');
    return {
      data: {
        sprint: sprintInfo(result.sprint),
        elapsedPct: health.elapsedPct,
        metrics: health.metrics,
        checks,
        healthScore: health.healthScore,
      },
      summary:
        `${result.sprint.name}: health ${health.healthScore}/100, ${health.elapsedPct}% of time elapsed, ` +
        `${health.metrics.completionPct}% completed.\n` +
        (flagged.length
          ? flagged
              .map(
                (c) =>
                  `${c.status.toUpperCase()} ${c.id} = ${c.value} (warn ${c.threshold.warn}, risk ${c.threshold.risk})`,
              )
              .join('\n')
          : 'All checks ok.'),
      source,
    };
  };
}
