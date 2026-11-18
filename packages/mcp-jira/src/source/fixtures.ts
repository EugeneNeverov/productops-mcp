import { readFileSync } from 'node:fs';
import * as z from 'zod/v4';
import {
  BoardType,
  IsoDateTime,
  LinkType,
  SprintChange,
  SprintState,
  StatusCategory,
  ToolFailure,
  type Project,
  type Sprint,
  type WorkItem,
} from '@productops-mcp/core';
import { Normalizer } from './normalize.js';
import type { JiraSource, Session, SiteInfo } from './types.js';

const RawItem = z.object({
  key: z.string(),
  type: z.string(),
  summary: z.string(),
  status: z.string(),
  statusCategory: StatusCategory,
  assignee: z.string().nullable(),
  points: z.number().nullable(),
  createdAt: IsoDateTime,
  transitions: z.array(
    z.object({ at: IsoDateTime, from: z.string(), to: z.string(), toCategory: StatusCategory }),
  ),
  sprintHistory: z.array(SprintChange),
  links: z.array(z.object({ type: LinkType, key: z.string() })),
  flagged: z.boolean(),
  parentKey: z.string().nullable(),
});
type RawItem = z.infer<typeof RawItem>;

const RawSprint = z.object({
  id: z.number().int(),
  name: z.string(),
  state: SprintState,
  startDate: IsoDateTime.nullable(),
  endDate: IsoDateTime.nullable(),
  completeDate: IsoDateTime.nullable(),
  goal: z.string().nullable(),
});

export const FixtureFile = z.object({
  version: z.literal(1),
  site: z.object({ cloudId: z.string(), url: z.string().url() }),
  now: IsoDateTime,
  projects: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      boards: z.array(z.object({ id: z.number().int(), name: z.string(), type: BoardType })),
    }),
  ),
  boards: z.record(z.string(), z.object({ sprints: z.array(RawSprint), items: z.array(RawItem) })),
});
export type FixtureFile = z.infer<typeof FixtureFile>;

export const DEMO_FIXTURES = new URL('../../demo-data/jira-demo.json', import.meta.url);

export function loadFixtureFile(path: string | URL): FixtureFile {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new ToolFailure(
      'FILE_PARSE_ERROR',
      `Cannot read Jira fixtures ${String(path)}: ${(err as Error).message}`,
    );
  }
  const parsed = FixtureFile.safeParse(raw);
  if (!parsed.success) {
    throw new ToolFailure('FILE_PARSE_ERROR', `Invalid Jira fixtures ${String(path)}`, {
      details: {
        issues: parsed.error.issues.slice(0, 10).map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
  }
  return parsed.data;
}

/**
 * Serves a recorded or synthetic dataset (demo, evals, CI). It spends the same number of upstream
 * calls the live source would, so budgets behave the same in both modes.
 */
export class FixtureSource implements JiraSource {
  readonly mode = 'fixtures' as const;
  private readonly byKey = new Map<string, RawItem>();

  constructor(
    private readonly data: FixtureFile,
    private readonly normalizer: Normalizer,
  ) {
    for (const board of Object.values(data.boards)) for (const it of board.items) this.byKey.set(it.key, it);
  }

  now(): Date {
    return new Date(this.data.now);
  }

  async site(session: Session): Promise<SiteInfo> {
    session.reserve(1, 'accessible sites');
    session.spend(1);
    return this.data.site;
  }

  async projects(session: Session): Promise<Project[]> {
    const n = 1 + this.data.projects.length; // listJiraProjects + listJiraBoards per project
    session.reserve(n, 'projects and boards');
    session.spend(n);
    return this.data.projects.map((p) => ({ ...p, url: `${this.data.site.url}/browse/${p.key}` }));
  }

  async sprints(boardId: number, session: Session): Promise<Sprint[]> {
    const board = this.board(boardId);
    session.reserve(1, `sprints of board ${boardId}`);
    session.spend(1);
    return [...board.sprints]
      .sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? '') || a.id - b.id)
      .map((s) => ({
        ...s,
        goal: s.goal === null ? null : this.normalizer.text(s.goal, `sprint:${s.id}`, session),
      }));
  }

  async sprintItems(boardId: number, sprintId: number, session: Session): Promise<WorkItem[]> {
    const id = String(sprintId);
    const raw = this.board(boardId).items.filter((it) => it.sprintHistory.some((c) => c.added.includes(id)));
    // getJiraBoardSprintData + a JQL search for removed items, then one changelog call per item.
    session.reserve(2 + raw.length, `sprint ${sprintId}`);
    session.spend(2 + raw.length);
    return raw.map((it) => this.toWorkItem(it, session));
  }

  async completedItems(boardId: number, from: Date, to: Date, session: Session): Promise<WorkItem[]> {
    const raw = this.board(boardId).items.filter((it) => {
      const done = [...it.transitions].reverse().find((t) => t.toCategory === 'done');
      if (!done || it.statusCategory !== 'done') return false;
      const at = new Date(done.at).getTime();
      return at >= from.getTime() && at < to.getTime();
    });
    session.reserve(1 + raw.length, `completed items of board ${boardId}`);
    session.spend(1 + raw.length);
    return raw.map((it) => this.toWorkItem(it, session));
  }

  private board(boardId: number) {
    const board = this.data.boards[String(boardId)];
    if (!board)
      throw new ToolFailure('NOT_FOUND', `Board ${boardId} not found.`, {
        hint: 'Call list_projects to see boards.',
      });
    return board;
  }

  private toWorkItem(it: RawItem, session: Session): WorkItem {
    const lastDone =
      it.statusCategory === 'done'
        ? [...it.transitions].reverse().find((t) => t.toCategory === 'done')
        : undefined;
    return {
      id: it.key.replace(/^\D+-/, ''),
      key: it.key,
      url: `${this.data.site.url}/browse/${it.key}`,
      type: it.type,
      summary: this.normalizer.text(it.summary, it.key, session),
      status: it.status,
      statusCategory: it.statusCategory,
      assignee: this.normalizer.person(it.assignee),
      estimate: it.points === null ? null : { value: it.points, unit: 'story_points' },
      createdAt: it.createdAt,
      resolvedAt: lastDone?.at ?? null,
      transitions: it.transitions,
      sprintHistory: it.sprintHistory,
      links: it.links.map((l) => {
        const target = this.byKey.get(l.key);
        return { type: l.type, key: l.key, targetDone: target ? target.statusCategory === 'done' : null };
      }),
      flagged: it.flagged,
      parentKey: it.parentKey,
    };
  }
}
