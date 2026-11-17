import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { McpServer } from '@modelcontextprotocol/server';
import { assessSprintHealth, JiraConfig, sprintScope, ToolFailure } from '@productops/core';
import * as z from 'zod/v4';
import { afterEach, describe, expect, it } from 'vitest';
import { Normalizer } from '../normalize.js';
import { Session } from '../types.js';
import { AtlassianMcpSource, categoryOf, guessCategory, idList, links } from './adapter.js';
import { FileCredentialStore } from './auth.js';
import { serverConnector } from './connect.js';
import { Upstream } from './upstream.js';

// A fake Atlassian Rovo MCP server with the response shapes recorded in the 2026-11-17 spike
// (docs/spikes/2026-11-17-atlassian-mcp.md): a Russian-localized company-managed Scrum project.
const SITE = 'https://example.atlassian.net';
const CLOUD = '11111111-2222-4333-8444-555555555555';
const START = '2026-11-02T09:00:00.000+0000';
const NOW = new Date('2026-11-09T09:00:00.000Z');

const status = (id: string, name: string, key: 'new' | 'indeterminate' | 'done') => ({
  id,
  name,
  statusCategory: { key, name: key === 'done' ? 'Готово' : key === 'new' ? 'К выполнению' : 'В работе' },
});
const TODO = status('10000', 'К выполнению', 'new');
const DOING = status('10001', 'В работе', 'indeterminate');
const DONE = status('10002', 'Готово', 'done');
const sprintValue = [{ id: 2, name: 'PO Demo Sprint 1', state: 'active', boardId: 2 }];

const issue = (key: string, st: object, points: number | null, extra: Record<string, unknown> = {}) => ({
  id: key.split('-')[1],
  key,
  fields: {
    summary: `Summary ${key}`,
    status: st,
    issuetype: { name: points === null ? 'Баг' : 'История' },
    assignee: { displayName: 'Dev One', accountId: 'acc-1' },
    created: '2026-11-01T10:00:00.000+0000',
    customFields: {
      'Story point estimate': { id: 'customfield_10016', value: points ?? undefined },
      Спринт: { id: 'customfield_10020', value: sprintValue },
      Flagged: {
        id: 'customfield_10021',
        value: extra.flagged ? [{ value: 'Impediment', id: '1' }] : undefined,
      },
    },
    ...(extra.fields as object),
  },
});

const ISSUES = [
  issue('MR12-1', DONE, 3),
  issue('MR12-2', DOING, 5, { flagged: true }),
  issue('MR12-3', TODO, null, {
    fields: {
      issuelinks: [
        {
          type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
          inwardIssue: { key: 'MR12-9', fields: { status: { statusCategory: { key: 'indeterminate' } } } },
        },
      ],
    },
  }),
  issue('MR12-4', DOING, 2),
];

const entry = (created: string, items: object[]) => ({ created, author: { accountId: 'x' }, items });
const CHANGELOGS: Record<string, object[]> = {
  'MR12-1': [
    entry('2026-11-01T12:00:00.000+0000', [
      { field: 'Sprint', from: '', fromString: '', to: '2', toString: 'PO Demo Sprint 1' },
    ]),
    entry('2026-11-02T10:00:00.000+0000', [
      { field: 'status', from: '10000', fromString: 'К выполнению', to: '10001', toString: 'В работе' },
    ]),
    entry('2026-11-04T10:00:00.000+0000', [
      { field: 'status', from: '10001', fromString: 'В работе', to: '10002', toString: 'Готово' },
    ]),
  ],
  'MR12-2': [
    entry('2026-11-01T12:00:00.000+0000', [{ field: 'Sprint', from: '', to: '2' }]),
    entry('2026-11-03T10:00:00.000+0000', [
      { field: 'status', from: '10000', to: '10001', toString: 'В работе' },
    ]),
    entry('2026-11-03T11:00:00.000+0000', [
      { field: 'Flagged', from: null, to: '[10019]', toString: 'Impediment' },
    ]),
  ],
  'MR12-3': [entry('2026-11-01T12:00:00.000+0000', [{ field: 'Sprint', from: '', to: '2' }])],
  // Added after the start.
  'MR12-4': [
    entry('2026-11-05T09:00:00.000+0000', [{ field: 'Sprint', from: '', to: '2' }]),
    entry('2026-11-05T10:00:00.000+0000', [
      { field: 'status', from: '10000', to: '10001', toString: 'В работе' },
    ]),
  ],
};

interface FakeOptions {
  failWith?: string;
}
const calls: { tool: string; op?: string }[] = [];

function fakeAtlassian(opts: FakeOptions = {}) {
  const server = new McpServer({ name: 'atlassian-mcp-server', version: '1.0.0' });
  const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] });
  const fail = () => ({ isError: true, content: [{ type: 'text' as const, text: opts.failWith! }] });
  server.registerTool('getAccessibleAtlassianResources', { inputSchema: z.object({}) }, async () => {
    calls.push({ tool: 'getAccessibleAtlassianResources' });
    return text({
      data: { resources: [{ cloudId: CLOUD, url: SITE, products: [{ id: 'jira-software' }] }] },
    });
  });
  server.registerTool(
    'searchJiraIssuesUsingJql',
    { inputSchema: z.looseObject({ jql: z.string() }) },
    async (args) => {
      calls.push({ tool: 'searchJiraIssuesUsingJql' });
      if (opts.failWith) return fail();
      const page2 = Boolean(args.nextPageToken);
      return text(
        page2
          ? { issues: ISSUES.slice(2), isLast: true }
          : { issues: ISSUES.slice(0, 2), isLast: false, nextPageToken: 'p2' },
      );
    },
  );
  server.registerTool(
    'executeRead',
    {
      inputSchema: z.looseObject({ name: z.string(), inputs: z.record(z.string(), z.unknown()).optional() }),
    },
    async (args) => {
      calls.push({ tool: 'executeRead', op: args.name });
      const inputs = (args.inputs ?? {}) as Record<string, string>;
      switch (args.name) {
        case 'listJiraProjects':
          return text({ values: [{ key: 'MR12', name: '12' }], startAt: 0, total: 1, isLast: true });
        case 'listJiraBoards':
          return text({
            values: [{ id: 2, name: 'Доска MR12', type: 'scrum' }],
            startAt: 0,
            total: 1,
            isLast: true,
          });
        case 'listJiraBoardSprints':
          return text({
            values: [
              {
                id: 2,
                state: 'active',
                name: 'PO Demo Sprint 1',
                startDate: START,
                endDate: '2026-11-16T09:00:00.000+0000',
                goal: 'Ship it',
              },
            ],
            startAt: 0,
            total: 1,
            isLast: true,
          });
        case 'getJiraBoardSprintData':
          return text({ issues: ISSUES.map((i) => ({ key: i.key, status: i.fields.status })) });
        case 'listJiraIssueChangelogs': {
          const values = CHANGELOGS[inputs.issueIdOrKey!] ?? [];
          return text({ values, startAt: 0, maxResults: 50, total: values.length, isLast: true });
        }
        default:
          return { isError: true, content: [{ type: 'text' as const, text: `unknown op ${args.name}` }] };
      }
    },
  );
  server.registerTool('createJiraIssue', { inputSchema: z.looseObject({}) }, async () => {
    calls.push({ tool: 'createJiraIssue' });
    return text({ key: 'MR12-99' });
  });
  return server;
}

async function source(opts: FakeOptions = {}, config: object = {}) {
  calls.length = 0;
  const server = fakeAtlassian(opts);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(clientT);
  const cfg = JiraConfig.parse(config);
  return {
    src: new AtlassianMcpSource(new Upstream(async () => client), cfg, new Normalizer(cfg), () => NOW),
    upstream: new Upstream(async () => client),
    close: () => client.close(),
  };
}

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

describe('AtlassianMcpSource (contract, recorded shapes)', () => {
  it('resolves the site, projects, boards and sprints', async () => {
    const s = await source();
    cleanup = s.close;
    const session = new Session(100);
    expect(await s.src.site(session)).toEqual({ cloudId: CLOUD, url: SITE });
    expect(await s.src.projects(session)).toEqual([
      {
        key: 'MR12',
        name: '12',
        url: `${SITE}/browse/MR12`,
        boards: [{ id: 2, name: 'Доска MR12', type: 'scrum' }],
      },
    ]);
    const [sprint] = await s.src.sprints(2, session);
    expect(sprint).toMatchObject({
      id: 2,
      state: 'active',
      startDate: '2026-11-02T09:00:00.000Z',
      goal: { text: 'Ship it', untrusted: true },
    });
    // site is cached: 1 + projects 1 + boards 1 + sprints 1
    expect(session.calls).toBe(4);
  });

  it('maps localized issues, changelogs, sprint history, flags and links', async () => {
    const s = await source();
    cleanup = s.close;
    const session = new Session(100);
    const items = await s.src.sprintItems(2, 2, session);
    expect(items.map((i) => [i.key, i.type, i.statusCategory, i.estimate?.value ?? null, i.flagged])).toEqual(
      [
        ['MR12-1', 'История', 'done', 3, false],
        ['MR12-2', 'История', 'in_progress', 5, true],
        ['MR12-3', 'Баг', 'todo', null, false],
        ['MR12-4', 'История', 'in_progress', 2, false],
      ],
    );
    const done = items[0]!;
    expect(done.transitions.map((t) => [t.to, t.toCategory])).toEqual([
      ['В работе', 'in_progress'],
      ['Готово', 'done'],
    ]);
    expect(done.resolvedAt).toBe('2026-11-04T10:00:00.000Z');
    expect(items[2]!.links).toEqual([{ type: 'is_blocked_by', key: 'MR12-9', targetDone: false }]);
    expect(items[3]!.sprintHistory).toEqual([{ at: '2026-11-05T09:00:00.000Z', added: ['2'], removed: [] }]);
    // 1 site + 1 board op + 2 JQL pages + 4 changelogs
    expect(session.calls).toBe(8);
    expect(session.warnings.map((w) => w.code)).toEqual(['REMOVED_ITEMS_UNKNOWN']);

    const sprints = await s.src.sprints(2, session);
    const scope = sprintScope(items, sprints[0]!, NOW);
    expect(scope.addedAfterStart.map((i) => i.key)).toEqual(['MR12-4']);
    const health = assessSprintHealth({
      current: { sprint: sprints[0]!, items },
      baseline: [],
      now: NOW,
      thresholds: JiraConfig.parse({}).health.thresholds,
      staleDays: 3,
      blockedStatuses: [],
    });
    expect(health.metrics.scopeChangePct).toBe(25); // MR12-4 2 pts of 8 at start
  });

  it('checks the budget before reading changelogs', async () => {
    const s = await source();
    cleanup = s.close;
    const session = new Session(5);
    await expect(s.src.sprintItems(2, 2, session)).rejects.toMatchObject({ code: 'QUOTA_BUDGET_EXCEEDED' });
    expect(calls.filter((c) => c.op === 'listJiraIssueChangelogs')).toHaveLength(0);
  });

  it('hides people when configured', async () => {
    const s = await source({}, { people: 'hashed' });
    cleanup = s.close;
    const items = await s.src.sprintItems(2, 2, new Session(100));
    expect(items[0]!.assignee).toMatch(/^person-[0-9a-f]{8}$/);
  });

  it.each([
    ['Error 429: Too Many Requests', 'RATE_LIMITED'],
    ['You have used all Rovo credits for this month', 'RATE_LIMITED'],
    ['401 Unauthorized', 'AUTH_EXPIRED'],
    ['403 Forbidden: missing scope', 'INSUFFICIENT_SCOPE'],
    ['Something broke', 'UPSTREAM_ERROR'],
  ])('maps upstream error "%s" to %s', async (failWith, code) => {
    const s = await source({ failWith });
    cleanup = s.close;
    await expect(s.src.sprintItems(2, 2, new Session(100))).rejects.toMatchObject({ code });
  });

  it('never calls write tools or non-allow-listed ops', async () => {
    const s = await source();
    cleanup = s.close;
    await expect(s.upstream.call('createJiraIssue', {})).rejects.toThrow(/not allowed/);
    await expect(s.upstream.call('executeRead', { name: 'manageJiraSprint' })).rejects.toThrow(/not allowed/);
    expect(calls).toEqual([]);
  });

  it('filters sites by configuration', async () => {
    const s = await source({}, { sites: ['other.atlassian.net'] });
    cleanup = s.close;
    await expect(s.src.site(new Session(10))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('mapping helpers', () => {
  it('reads status categories from key, id or color', () => {
    expect(categoryOf({ key: 'done' })).toBe('done');
    expect(categoryOf({ id: 4 })).toBe('in_progress');
    expect(categoryOf({ colorName: 'blue-gray' })).toBe('todo');
    expect(categoryOf({ name: 'Готово' })).toBeUndefined();
  });
  it('guesses categories from English and Russian names', () => {
    expect(guessCategory('Готово')).toBe('done');
    expect(guessCategory('К выполнению')).toBe('todo');
    expect(guessCategory('Code review')).toBe('in_progress');
  });
  it('parses sprint id lists and links', () => {
    expect(idList('12, 13')).toEqual(['12', '13']);
    expect(idList(null)).toEqual([]);
    expect(
      links([
        {
          type: { name: 'Blocks' },
          outwardIssue: { key: 'A-2', fields: { status: { statusCategory: { key: 'done' } } } },
        },
      ]),
    ).toEqual([{ type: 'blocks', key: 'A-2', targetDone: true }]);
  });
});

describe('server connector', () => {
  it('asks for login when no credentials are stored', async () => {
    const store = new FileCredentialStore(join(mkdtempSync(join(tmpdir(), 'pocred-')), 'oauth.json'));
    const err = await serverConnector(store)().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ToolFailure);
    expect(err).toMatchObject({
      code: 'AUTH_REQUIRED',
      hint: expect.stringContaining('productops-jira login'),
    });
  });

  it('stores credentials atomically and privately', () => {
    const store = new FileCredentialStore(join(mkdtempSync(join(tmpdir(), 'pocred-')), 'sub', 'oauth.json'));
    store.update({ tokens: { access_token: 'a', token_type: 'bearer', refresh_token: 'r' } });
    expect(store.hasTokens()).toBe(true);
    store.remove(['tokens']);
    expect(store.hasTokens()).toBe(false);
  });
});
