import {
  ToolFailure,
  type JiraConfig,
  type Project,
  type Sprint,
  type SprintChange,
  type StatusCategory,
  type Transition,
  type WorkItem,
  type WorkLink,
} from '@productops/core';
import type { Normalizer } from '../normalize.js';
import type { JiraSource, Session, SiteInfo } from '../types.js';
import type { Upstream } from './upstream.js';

/**
 * Reads Jira through the Atlassian Rovo MCP server and maps it to WorkItem (ADR 0002).
 * This is the only place that knows Atlassian tool names and response shapes; shapes follow the
 * 2026-11-17 spike and are parsed defensively, because the server declares no output schemas.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped upstream JSON
type Json = any;

const PAGE = 50;
const CONCURRENCY = 4;
const STORY_POINT_NAMES = ['story point estimate', 'story points'];

export class AtlassianMcpSource implements JiraSource {
  readonly mode = 'live' as const;
  private siteInfo: SiteInfo | undefined;
  private boardProjects = new Map<number, string>();
  /** Status id → category, learned from every issue seen (changelogs only carry status ids). */
  private statusCategories = new Map<string, StatusCategory>();

  constructor(
    private readonly upstream: Upstream,
    private readonly config: JiraConfig,
    private readonly normalizer: Normalizer,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  now(): Date {
    return this.clock();
  }

  async site(session: Session): Promise<SiteInfo> {
    if (this.siteInfo) return this.siteInfo;
    session.reserve(1, 'accessible sites');
    session.spend(1);
    const data: Json = await this.upstream.call('getAccessibleAtlassianResources', {});
    const resources: Json[] = arrayIn(data, ['resources']) ?? [];
    const jira = resources.filter(
      (r) => !Array.isArray(r.products) || r.products.some((p: Json) => /jira/i.test(String(p?.id ?? p))),
    );
    const wanted = this.config.sites.map((s) => s.toLowerCase());
    const pick = wanted.length ? jira.find((r) => wanted.includes(hostOf(r.url))) : jira[0];
    if (!pick) {
      throw new ToolFailure('NOT_FOUND', 'No accessible Jira site matches the configuration.', {
        hint: wanted.length
          ? `jira.sites allows ${wanted.join(', ')}; the account can see ${resources.map((r) => hostOf(r.url)).join(', ') || 'no sites'}.`
          : 'Sign in with an account that has Jira access (`productops-jira login`).',
      });
    }
    this.siteInfo = { cloudId: String(pick.cloudId ?? pick.id), url: String(pick.url).replace(/\/+$/, '') };
    return this.siteInfo;
  }

  async projects(session: Session): Promise<Project[]> {
    const site = await this.site(session);
    const projects = await this.paged(session, 'projects', (startAt) =>
      this.read(site, 'listJiraProjects', { startAt, maxResults: PAGE }),
    );
    session.reserve(projects.length, 'boards per project');
    const out: Project[] = [];
    for (const p of projects) {
      const key = String(p.key);
      const boards = await this.paged(session, `boards of ${key}`, (startAt) =>
        this.read(site, 'listJiraBoards', { projectKeyOrId: key, startAt, maxResults: PAGE }),
      );
      for (const b of boards) this.boardProjects.set(Number(b.id), key);
      out.push({
        key,
        name: String(p.name ?? key),
        url: `${site.url}/browse/${key}`,
        boards: boards.map((b) => ({
          id: Number(b.id),
          name: String(b.name ?? b.id),
          type: boardType(b.type),
        })),
      });
    }
    return out;
  }

  async sprints(boardId: number, session: Session): Promise<Sprint[]> {
    const site = await this.site(session);
    const raw = await this.paged(session, `sprints of board ${boardId}`, (startAt) =>
      this.read(site, 'listJiraBoardSprints', { boardId, state: 'all', startAt, maxResults: PAGE }),
    );
    return raw
      .map((s) => ({
        id: Number(s.id),
        name: String(s.name ?? `Sprint ${s.id}`),
        state: s.state === 'active' || s.state === 'closed' ? s.state : 'future',
        startDate: isoOrNull(s.startDate),
        endDate: isoOrNull(s.endDate),
        completeDate: isoOrNull(s.completeDate),
        goal: s.goal ? this.normalizer.text(String(s.goal), `sprint:${s.id}`, session) : null,
      }))
      .sort(
        (a, b) => (a.startDate ?? '9999').localeCompare(b.startDate ?? '9999') || a.id - b.id,
      ) as Sprint[];
  }

  async sprintItems(boardId: number, sprintId: number, session: Session): Promise<WorkItem[]> {
    const site = await this.site(session);
    // The board op returns status category keys, which JQL with explicit fields does not (spike gap 2).
    session.reserve(1, `sprint ${sprintId}`);
    session.spend(1);
    const board: Json = await this.read(site, 'getJiraBoardSprintData', {
      boardId: String(boardId),
      sprintId: String(sprintId),
    });
    for (const i of arrayIn(board, ['issues']) ?? []) this.learnStatus(i.status ?? i.fields?.status);
    const issues = await this.search(
      site,
      `sprint = ${sprintId} ORDER BY key`,
      session,
      `sprint ${sprintId}`,
    );
    // Removed items no longer match `sprint = N`; finding them needs more than JQL offers (spike gap 1).
    if (!session.warnings.some((w) => w.code === 'REMOVED_ITEMS_UNKNOWN')) {
      session.warnings.push({
        code: 'REMOVED_ITEMS_UNKNOWN',
        message:
          'Live mode cannot yet list issues removed from a sprint; scope change counts added work only.',
      });
    }
    return this.withHistory(site, issues, session, sprintId);
  }

  async completedItems(boardId: number, from: Date, to: Date, session: Session): Promise<WorkItem[]> {
    const site = await this.site(session);
    if (!this.boardProjects.has(boardId)) await this.projects(session);
    const project = this.boardProjects.get(boardId);
    if (!project)
      throw new ToolFailure('NOT_FOUND', `Board ${boardId} not found.`, { hint: 'Call list_projects.' });
    const day = (d: Date) => d.toISOString().slice(0, 10);
    const jql = `project = ${jqlString(project)} AND statusCategory = Done AND updated >= "${day(from)}" ORDER BY key`;
    const issues = await this.search(site, jql, session, `completed items of ${project}`);
    const items = await this.withHistory(site, issues, session);
    return items.filter((i) => {
      const done = [...i.transitions].reverse().find((t) => t.toCategory === 'done');
      const at = done ? new Date(done.at).getTime() : NaN;
      return at >= from.getTime() && at < to.getTime();
    });
  }

  // ---------- helpers ----------

  private read(site: SiteInfo, name: string, inputs: Record<string, unknown>) {
    return this.upstream.call('executeRead', { name, cloudId: site.cloudId, inputs });
  }

  /** Pages through `startAt/maxResults/isLast` results, spending one call per page. */
  private async paged(
    session: Session,
    what: string,
    fetch: (startAt: number) => Promise<Json>,
  ): Promise<Json[]> {
    const out: Json[] = [];
    for (let startAt = 0, guard = 0; guard < 100; guard++) {
      session.reserve(1, what);
      session.spend(1);
      const page: Json = await fetch(startAt);
      const values: Json[] = arrayIn(page, ['values', 'results', 'projects', 'boards', 'sprints']) ?? [];
      out.push(...values);
      const total = Number(page?.total);
      if (page?.isLast === true || values.length === 0 || (Number.isFinite(total) && out.length >= total))
        break;
      if (page?.isLast !== false && !Number.isFinite(total)) break;
      startAt += values.length;
    }
    return out;
  }

  private async search(site: SiteInfo, jql: string, session: Session, what: string): Promise<Json[]> {
    const issues: Json[] = [];
    let nextPageToken: string | undefined;
    for (let guard = 0; guard < 40; guard++) {
      session.reserve(1, what);
      session.spend(1);
      const page: Json = await this.upstream.call('searchJiraIssuesUsingJql', {
        cloudId: site.cloudId,
        jql,
        maxResults: PAGE,
        view: 'evidence',
        ...(nextPageToken ? { nextPageToken } : {}),
      });
      const batch: Json[] = arrayIn(page, ['issues']) ?? [];
      issues.push(...batch);
      nextPageToken = page?.nextPageToken;
      if (page?.isLast !== false || !nextPageToken || batch.length === 0) break;
    }
    for (const i of issues) this.learnStatus(i.fields?.status);
    return issues;
  }

  /** One changelog call per issue (paged), run with limited concurrency after a budget check. */
  private async withHistory(site: SiteInfo, issues: Json[], session: Session, sprintId?: number) {
    session.reserve(issues.length, 'issue changelogs');
    const changelogs: Json[][] = new Array(issues.length);
    let next = 0;
    const worker = async () => {
      while (next < issues.length) {
        const idx = next++;
        changelogs[idx] = await this.paged(session, 'issue changelog', (startAt) =>
          this.read(site, 'listJiraIssueChangelogs', {
            issueIdOrKey: String(issues[idx].key),
            startAt,
            maxResults: PAGE,
          }),
        );
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, issues.length) }, worker));
    return issues.map((issue, i) => this.toWorkItem(site, issue, changelogs[i] ?? [], session, sprintId));
  }

  /**
   * Remembers a status's category by id and by name. The board op carries the category key but no
   * status id, and changelogs and JQL results name statuses without the key, so both are needed.
   */
  private learnStatus(status: Json) {
    if (!status) return;
    const cat = categoryOf(status.statusCategory);
    if (!cat) return;
    if (status.id !== undefined && status.id !== null) this.statusCategories.set(String(status.id), cat);
    if (status.name) this.statusCategories.set(statusNameKey(status.name), cat);
  }

  private knownCategory(id: unknown, name: unknown): StatusCategory | undefined {
    return (
      (id !== undefined && id !== null && id !== '' ? this.statusCategories.get(String(id)) : undefined) ??
      (name ? this.statusCategories.get(statusNameKey(name)) : undefined)
    );
  }

  private toWorkItem(
    site: SiteInfo,
    issue: Json,
    changelog: Json[],
    session: Session,
    sprintId?: number,
  ): WorkItem {
    const f: Json = issue.fields ?? {};
    const key = String(issue.key);
    const custom: Json = f.customFields ?? {};
    const status = f.status ?? {};
    const known = categoryOf(status.statusCategory) ?? this.knownCategory(status.id, status.name);
    const statusCategory = known ?? guessCategory(status.name);
    if (!known) {
      warnOnce(
        session,
        'UNKNOWN_STATUS_CATEGORY',
        `Status category of some issues was guessed from the status name.`,
        key,
      );
    }

    const transitions: Transition[] = [];
    const sprintHistory: SprintChange[] = [];
    for (const entry of [...changelog].sort((a, b) => String(a.created).localeCompare(String(b.created)))) {
      const at = isoOrNull(entry.created);
      if (!at) continue;
      for (const item of entry.items ?? []) {
        const field = String(item.field ?? item.fieldId ?? '').toLowerCase();
        if (field === 'status') {
          const toId = item.to === null || item.to === undefined ? '' : String(item.to);
          const toName = String(item.toString ?? toId);
          transitions.push({
            at,
            from: String(item.fromString ?? item.from ?? ''),
            to: toName,
            toCategory: this.knownCategory(toId, toName) ?? guessCategory(toName),
          });
        } else if (field === 'sprint') {
          const from = idList(item.from);
          const to = idList(item.to);
          const added = to.filter((s) => !from.includes(s));
          const removed = from.filter((s) => !to.includes(s));
          if (added.length || removed.length) sprintHistory.push({ at, added, removed });
        }
      }
    }

    // An issue created straight into a sprint has no Sprint changelog entry: add it at creation.
    const currentSprints = sprintIds(
      findCustom(custom, (v) => Array.isArray(v) && v.some((s) => s && 'state' in s && 'id' in s)),
    );
    const createdAt = isoOrNull(f.created) ?? new Date(0).toISOString();
    for (const sid of currentSprints) {
      if (!sprintHistory.some((c) => c.added.includes(sid)))
        sprintHistory.unshift({ at: createdAt, added: [sid], removed: [] });
    }
    if (sprintId !== undefined && !sprintHistory.some((c) => c.added.includes(String(sprintId)))) {
      sprintHistory.unshift({ at: createdAt, added: [String(sprintId)], removed: [] });
    }

    const pointsField = this.config.fields.storyPoints;
    const points = pointsField
      ? findCustomById(custom, f, pointsField)
      : findCustomByName(custom, STORY_POINT_NAMES);
    const flaggedValue = findCustomByName(custom, ['flagged']);
    const lastDone =
      statusCategory === 'done' ? [...transitions].reverse().find((t) => t.toCategory === 'done') : undefined;

    return {
      id: String(issue.id ?? key),
      key,
      url: `${site.url}/browse/${key}`,
      type: String(f.issuetype?.name ?? 'Issue'),
      summary: this.normalizer.text(String(f.summary ?? ''), key, session),
      status: String(status.name ?? 'Unknown'),
      statusCategory,
      assignee: this.normalizer.person(f.assignee?.displayName ?? null, f.assignee?.accountId ?? null),
      estimate: typeof points === 'number' ? { value: points, unit: 'story_points' } : null,
      createdAt,
      resolvedAt: isoOrNull(f.resolutiondate) ?? lastDone?.at ?? null,
      transitions,
      sprintHistory,
      links: links(f.issuelinks),
      flagged: Array.isArray(flaggedValue) ? flaggedValue.length > 0 : Boolean(flaggedValue),
      parentKey: f.parent?.key ? String(f.parent.key) : null,
    };
  }
}

// ---------- pure mapping helpers (exported for tests) ----------

export function arrayIn(v: Json, keys: string[]): Json[] | undefined {
  if (Array.isArray(v)) return v;
  if (!v || typeof v !== 'object') return undefined;
  for (const k of keys) if (Array.isArray(v[k])) return v[k];
  for (const k of ['data', 'result']) {
    const inner = arrayIn(v[k], keys);
    if (inner) return inner;
  }
  return undefined;
}

function statusNameKey(name: unknown): string {
  return `name:${String(name).trim().toLowerCase()}`;
}

export function categoryOf(cat: Json): StatusCategory | undefined {
  const key = String(cat?.key ?? '').toLowerCase();
  if (key === 'done') return 'done';
  if (key === 'indeterminate') return 'in_progress';
  if (key === 'new') return 'todo';
  const id = Number(cat?.id);
  if (id === 3) return 'done';
  if (id === 4) return 'in_progress';
  if (id === 2) return 'todo';
  const color = String(cat?.colorName ?? '');
  if (color === 'green') return 'done';
  if (color === 'yellow') return 'in_progress';
  if (color === 'blue-gray') return 'todo';
  return undefined;
}

/** Last resort for statuses never seen with a category (English and Russian defaults). */
export function guessCategory(name: unknown): StatusCategory {
  const n = String(name ?? '').toLowerCase();
  if (/done|closed|resolved|complete|готово|выполнено|закрыт|решен/.test(n)) return 'done';
  if (/to ?do|open|backlog|new|selected|к выполнению|открыт|бэклог|нов/.test(n)) return 'todo';
  return 'in_progress';
}

function boardType(t: unknown): Project['boards'][number]['type'] {
  return t === 'scrum' || t === 'kanban' || t === 'simple' ? t : 'other';
}

function hostOf(url: unknown): string {
  try {
    return new URL(String(url)).hostname.toLowerCase();
  } catch {
    return String(url).toLowerCase();
  }
}

function isoOrNull(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Changelog Sprint values are comma-separated sprint ids ("12, 13"). */
export function idList(v: unknown): string[] {
  if (v === null || v === undefined) return [];
  return String(v)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s));
}

function sprintIds(v: Json): string[] {
  return Array.isArray(v) ? v.map((s) => String(s.id)) : [];
}

/** Custom fields arrive as `{ "<display name>": { id, value } }`; display names may be localized. */
function findCustom(custom: Json, pred: (value: Json) => boolean): Json {
  for (const entry of Object.values(custom ?? {})) {
    const value = (entry as Json)?.value;
    if (pred(value)) return value;
  }
  return undefined;
}

function findCustomByName(custom: Json, names: string[]): Json {
  for (const [name, entry] of Object.entries(custom ?? {})) {
    if (names.includes(name.toLowerCase())) return (entry as Json)?.value;
  }
  return undefined;
}

function findCustomById(custom: Json, fields: Json, id: string): Json {
  for (const entry of Object.values(custom ?? {}))
    if ((entry as Json)?.id === id) return (entry as Json).value;
  return fields?.[id];
}

export function links(raw: Json): WorkLink[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((l): WorkLink[] => {
    const isBlocks =
      /^blocks$/i.test(String(l?.type?.name ?? '')) || /block/i.test(String(l?.type?.outward ?? ''));
    const target = l.inwardIssue ?? l.outwardIssue;
    if (!target?.key) return [];
    const cat = categoryOf(target.fields?.status?.statusCategory);
    const type: WorkLink['type'] = isBlocks
      ? l.inwardIssue
        ? 'is_blocked_by'
        : 'blocks'
      : /relat/i.test(String(l?.type?.name ?? ''))
        ? 'relates'
        : 'other';
    return [{ type, key: String(target.key), targetDone: cat ? cat === 'done' : null }];
  });
}

function jqlString(s: string): string {
  return `"${s.replace(/["\\]/g, '\\$&')}"`;
}

function warnOnce(session: Session, code: string, message: string, key: string) {
  const existing = session.warnings.find((w) => w.code === code);
  if (existing) {
    existing.itemIds = [...new Set([...(existing.itemIds ?? []), key])].sort();
  } else session.warnings.push({ code, message, itemIds: [key] });
}
