import type { Project, Sprint, Warning, WorkItem } from '@productops/core';
import type { JiraSource, Session, SiteInfo } from '../source/types.js';
import { cacheKey, type Store } from './store.js';

/** Cache TTLs in seconds (spec §7.4). */
export const TTL = {
  site: 3600,
  projects: 3600,
  sprints: 900,
  activeSprintItems: 300,
  closedSprintItems: 7 * 86_400,
  completedItems: 3600,
} as const;

interface Entry<T> {
  value: T;
  suspicious: string[];
  warnings: Warning[];
}

/**
 * Read-through cache around a live source. A hit spends no upstream calls; `refresh: true`
 * skips reads (but still writes). Sanitizer findings and warnings are cached with the data, so a
 * hit reports the same SUSPICIOUS_CONTENT and gap warnings as the original read.
 */
export class CachingSource implements JiraSource {
  readonly mode: JiraSource['mode'];
  private sprintState = new Map<string, Sprint['state']>();

  constructor(
    private readonly inner: JiraSource,
    private readonly store: Store,
  ) {
    this.mode = inner.mode;
  }

  now(): Date {
    return this.inner.now();
  }

  site(session: Session): Promise<SiteInfo> {
    return this.cached(session, ['site'], TTL.site, () => this.inner.site(session));
  }

  /** The site used to build cache keys. A hit here is bookkeeping, not data, so it is not reported. */
  private siteKey(session: Session): Promise<SiteInfo> {
    return this.cached(session, ['site'], TTL.site, () => this.inner.site(session), false);
  }

  async projects(session: Session): Promise<Project[]> {
    const site = await this.siteKey(session);
    return this.cached(session, [site.cloudId, 'projects'], TTL.projects, () => this.inner.projects(session));
  }

  async sprints(boardId: number, session: Session): Promise<Sprint[]> {
    const site = await this.siteKey(session);
    const sprints = await this.cached(session, [site.cloudId, 'sprints', boardId], TTL.sprints, () =>
      this.inner.sprints(boardId, session),
    );
    for (const s of sprints) this.sprintState.set(`${site.cloudId}:${s.id}`, s.state);
    return sprints;
  }

  async sprintItems(boardId: number, sprintId: number, session: Session): Promise<WorkItem[]> {
    const site = await this.siteKey(session);
    let state = this.sprintState.get(`${site.cloudId}:${sprintId}`);
    if (!state) {
      await this.sprints(boardId, session);
      state = this.sprintState.get(`${site.cloudId}:${sprintId}`);
    }
    const ttl = state === 'closed' ? TTL.closedSprintItems : TTL.activeSprintItems;
    return this.cached(session, [site.cloudId, 'sprintItems', boardId, sprintId], ttl, () =>
      this.inner.sprintItems(boardId, sprintId, session),
    );
  }

  async completedItems(boardId: number, from: Date, to: Date, session: Session): Promise<WorkItem[]> {
    const site = await this.siteKey(session);
    return this.cached(
      session,
      [site.cloudId, 'completedItems', boardId, from.toISOString(), to.toISOString()],
      TTL.completedItems,
      () => this.inner.completedItems(boardId, from, to, session),
    );
  }

  private async cached<T>(
    session: Session,
    parts: unknown[],
    ttlS: number,
    load: () => Promise<T>,
    report = true,
  ): Promise<T> {
    const key = cacheKey([this.mode, ...parts]);
    const now = Date.now();
    if (!session.refresh) {
      const hit = this.store.cacheGet(key, now);
      if (hit) {
        const entry = hit.value as Entry<T>;
        for (const k of entry.suspicious) session.suspiciousKeys.add(k);
        for (const w of entry.warnings)
          if (!session.warnings.some((x) => x.code === w.code)) session.warnings.push(w);
        if (report) session.noteCacheHit(hit.fetchedAt);
        return entry.value;
      }
    }
    const before = new Set(session.suspiciousKeys);
    const warningsBefore = session.warnings.length;
    const value = await load();
    session.noteFetch();
    const entry: Entry<T> = {
      value,
      suspicious: [...session.suspiciousKeys].filter((k) => !before.has(k)),
      warnings: session.warnings.slice(warningsBefore),
    };
    this.store.cacheSet(key, entry, ttlS, now);
    return value;
  }
}
