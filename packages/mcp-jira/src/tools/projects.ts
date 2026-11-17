import * as z from 'zod/v4';
import { BoardType, createToolPolicy, Meta, type ToolContext } from '@productops/core';
import { Refresh, withSession, type JiraEnv } from './common.js';

export const ListProjectsInput = z.object({
  query: z.string().max(100).optional().describe('Case-insensitive filter on project key or name'),
  includeBoards: z.boolean().default(true),
  limit: z.number().int().min(1).max(100).default(50),
  refresh: Refresh,
});
export type ListProjectsInput = z.infer<typeof ListProjectsInput>;

const BoardOut = z.object({ id: z.number().int(), name: z.string(), type: BoardType });

export const ListProjectsOutput = z.object({
  site: z.object({ cloudId: z.string(), url: z.string().url() }),
  projects: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      url: z.string().url(),
      boards: z.array(BoardOut).optional(),
    }),
  ),
  truncated: z.boolean(),
  meta: Meta,
});

export const listProjectsDescription =
  'List the Jira projects (and their boards) this server may read. Use it to find the boardId for the other tools. ' +
  'Only projects allowed by the server configuration are shown.';

export function createListProjectsHandler(env: JiraEnv) {
  const allowed = createToolPolicy(env.config.projects);
  return async (input: ListProjectsInput, ctx: ToolContext) => {
    const { result, source } = await withSession(env, ctx, async (session, site) => {
      const q = input.query?.toLowerCase();
      const all = (await env.source.projects(session))
        .filter((p) => allowed.isAllowed(p.key))
        .filter((p) => !q || p.key.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
        .sort((a, b) => a.key.localeCompare(b.key));
      return { site, all };
    });
    const projects = result.all.slice(0, input.limit).map((p) => ({
      key: p.key,
      name: p.name,
      url: p.url,
      ...(input.includeBoards ? { boards: p.boards } : {}),
    }));
    const lines = projects.map(
      (p) =>
        `${p.key} — ${p.name}${p.boards ? ': ' + p.boards.map((b) => `board ${b.id} (${b.type})`).join(', ') : ''}`,
    );
    return {
      data: { site: result.site, projects, truncated: result.all.length > projects.length },
      summary: `${projects.length} project(s) on ${result.site.url}\n${lines.join('\n')}`,
      source,
    };
  };
}
