import type { Sprint, StatusCategory, WorkItem } from './model.js';

/** Compact builder for hand-written work items in tests and fixtures. */
export interface ItemSpec {
  key: string;
  type?: string;
  points?: number | null;
  assignee?: string | null;
  createdAt?: string;
  /** [at, status name, category] oldest first. */
  moves?: [string, string, StatusCategory][];
  /** [at, added sprint ids, removed sprint ids]. */
  sprints?: [string, number[], number[]][];
  flagged?: boolean;
  blockedBy?: [string, boolean | null][];
  summary?: string;
}

export function item(spec: ItemSpec, site = 'https://example.atlassian.net'): WorkItem {
  const moves = spec.moves ?? [];
  const last = moves.at(-1);
  let from = 'To Do';
  return {
    id: spec.key.replace(/\D/g, '') || spec.key,
    key: spec.key,
    url: `${site}/browse/${spec.key}`,
    type: spec.type ?? 'Story',
    summary: { text: spec.summary ?? `Summary of ${spec.key}`, untrusted: true, truncated: false },
    status: last ? last[1] : 'To Do',
    statusCategory: last ? last[2] : 'todo',
    assignee: spec.assignee ?? null,
    estimate:
      spec.points === undefined || spec.points === null ? null : { value: spec.points, unit: 'story_points' },
    createdAt: spec.createdAt ?? '2026-10-01T09:00:00.000Z',
    resolvedAt: last && last[2] === 'done' ? last[0] : null,
    transitions: moves.map(([at, to, toCategory]) => {
      const t = { at, from, to, toCategory };
      from = to;
      return t;
    }),
    sprintHistory: (spec.sprints ?? []).map(([at, added, removed]) => ({
      at,
      added: added.map(String),
      removed: removed.map(String),
    })),
    links: (spec.blockedBy ?? []).map(([key, targetDone]) => ({
      type: 'is_blocked_by' as const,
      key,
      targetDone,
    })),
    flagged: spec.flagged ?? false,
    parentKey: null,
  };
}

export function sprint(s: Partial<Sprint> & Pick<Sprint, 'id' | 'state'>): Sprint {
  return {
    name: `Sprint ${s.id}`,
    startDate: null,
    endDate: null,
    completeDate: null,
    goal: null,
    ...s,
  };
}
