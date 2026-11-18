import type { Project, Sprint, Warning, WorkItem } from '@productops-mcp/core';
import { ToolFailure } from '@productops-mcp/core';

/** Per-tool-call state shared with the source: the call budget and soft problems found while reading. */
export class Session {
  calls = 0;
  readonly suspiciousKeys = new Set<string>();
  readonly warnings: Warning[] = [];

  /** Skip cache reads for this call (`refresh: true`). */
  refresh = false;
  cacheHits = 0;
  fetches = 0;
  /** Oldest fetch time among cached reads, ms. */
  oldestCached: number | undefined;

  constructor(readonly maxCalls: number) {}

  noteCacheHit(fetchedAt: number): void {
    this.cacheHits++;
    this.oldestCached = Math.min(this.oldestCached ?? fetchedAt, fetchedAt);
  }

  noteFetch(): void {
    this.fetches++;
  }

  /** Fails before spending when `n` more upstream calls would exceed the budget (ADR 0002). */
  reserve(n: number, what: string): void {
    if (this.calls + n > this.maxCalls) {
      throw new ToolFailure(
        'QUOTA_BUDGET_EXCEEDED',
        `Reading ${what} needs about ${this.calls + n} upstream calls; the limit per tool call is ${this.maxCalls}.`,
        {
          hint: 'Narrow the request (fewer baseline sprints, a shorter window) or raise jira.budget.maxCallsPerTool.',
          details: { needed: this.calls + n, limit: this.maxCalls },
        },
      );
    }
  }

  spend(n: number): void {
    this.calls += n;
  }
}

export interface SiteInfo {
  cloudId: string;
  url: string;
}

/**
 * Where Jira data comes from. Metrics never know which implementation is used.
 * Every method spends upstream calls on the session (and checks the budget first).
 */
export interface JiraSource {
  readonly mode: 'fixtures' | 'live';
  site(session: Session): Promise<SiteInfo>;
  /** The clock metrics use: real time live, the dataset's frozen time in fixtures. */
  now(): Date;
  projects(session: Session): Promise<Project[]>;
  /** All sprints of a board, oldest first. */
  sprints(boardId: number, session: Session): Promise<Sprint[]>;
  /** Every item that was ever in the sprint, including items removed from it, with history. */
  sprintItems(boardId: number, sprintId: number, session: Session): Promise<WorkItem[]>;
  /** Items of the board whose last move to done falls in [from, to). */
  completedItems(boardId: number, from: Date, to: Date, session: Session): Promise<WorkItem[]>;
}
