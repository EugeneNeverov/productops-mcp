import * as z from 'zod/v4';
import {
  findBlockers,
  Meta,
  sprintScope,
  StatusCategory,
  UntrustedText,
  type ToolContext,
} from '@productops-mcp/core';
import { Refresh, resolveSprint, SprintSelector, withSession, type JiraEnv } from './common.js';

export const FindBlockersInput = z.object({
  boardId: z.number().int(),
  sprint: SprintSelector,
  staleDays: z
    .number()
    .int()
    .min(1)
    .max(30)
    .default(3)
    .describe('In progress with no transition for this many working days counts as stale'),
  limit: z.number().int().min(1).max(50).default(20),
  refresh: Refresh,
});
export type FindBlockersInput = z.infer<typeof FindBlockersInput>;

export const Signal = z.enum(['FLAGGED', 'BLOCKED_BY_OPEN_LINK', 'STALE_IN_PROGRESS', 'BLOCKED_STATUS']);

export const FindBlockersOutput = z.object({
  sprint: z.object({ id: z.number().int(), name: z.string() }),
  blockers: z.array(
    z.object({
      key: z.string(),
      url: z.string().url(),
      summary: UntrustedText,
      status: z.string(),
      statusCategory: StatusCategory,
      signals: z.array(Signal),
      blockedBy: z.array(z.object({ key: z.string(), url: z.string().url(), done: z.boolean() })),
      daysInCurrentStatus: z.number(),
      severity: z.enum(['high', 'medium', 'low']),
    }),
  ),
  truncated: z.boolean(),
  meta: Meta,
});

export const findBlockersDescription =
  'Not-done issues in a sprint that look blocked: flagged, blocked by an open issue link, stale in progress, or in a ' +
  '"Blocked" status. Each comes with its signals and a severity (high: 2+ signals or a big item behind an open link).';

export function createFindBlockersHandler(env: JiraEnv) {
  return async (input: FindBlockersInput, ctx: ToolContext) => {
    const { result, source } = await withSession(
      env,
      ctx,
      async (session, site) => {
        const sprints = await env.source.sprints(input.boardId, session);
        const sprint = resolveSprint(sprints, input.sprint, input.boardId);
        const items = await env.source.sprintItems(input.boardId, sprint.id, session);
        const now = env.source.now();
        const scope = sprintScope(items, sprint, now);
        const found = findBlockers(scope.members, {
          now: new Date(scope.evaluatedAt),
          staleDays: input.staleDays,
          blockedStatuses: env.config.blockedStatuses,
        });
        return { sprint, found, site };
      },
      { refresh: input.refresh },
    );
    const shown = result.found.slice(0, input.limit);
    const blockers = shown.map((b) => ({
      key: b.item.key,
      url: b.item.url,
      summary: b.item.summary,
      status: b.item.status,
      statusCategory: b.statusCategory,
      signals: b.signals,
      blockedBy: b.blockedBy.map((l) => ({ ...l, url: `${result.site.url}/browse/${l.key}` })),
      daysInCurrentStatus: b.daysInCurrentStatus,
      severity: b.severity,
    }));
    const lines = blockers.map((b) => `${b.severity.toUpperCase()} ${b.key}: ${b.signals.join(', ')}`);
    return {
      data: {
        sprint: { id: result.sprint.id, name: result.sprint.name },
        blockers,
        truncated: result.found.length > shown.length,
      },
      summary: `${result.found.length} possible blocker(s) in ${result.sprint.name}\n${lines.join('\n')}`,
      source,
    };
  };
}
