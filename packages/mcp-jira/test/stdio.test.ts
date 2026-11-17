import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const BIN = fileURLToPath(new URL('../dist/bin.js', import.meta.url));
// Fixtures mode must never touch the network; reuse the prioritization server's guard.
const NO_NETWORK = pathToFileURL(
  fileURLToPath(new URL('../../mcp-prioritization/test/no-network.mjs', import.meta.url)),
).href;

type Result = { isError?: boolean; structuredContent?: unknown; content?: { type: string; text?: string }[] };
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose access to tool JSON in assertions
const sc = (r: unknown) => (r as Result).structuredContent as Record<string, any>;

async function connect(config?: object, extraEnv: Record<string, string> = {}) {
  const env: Record<string, string> = { PRODUCTOPS_LOG_LEVEL: 'silent', ...extraEnv };
  if (config) {
    const dir = mkdtempSync(join(tmpdir(), 'pojira-'));
    const path = join(dir, 'productops.config.json');
    writeFileSync(path, JSON.stringify(config));
    env.PRODUCTOPS_CONFIG = path;
  }
  const client = new Client({ name: 'e2e', version: '0' });
  await client.connect(
    new StdioClientTransport({ command: process.execPath, args: ['--import', NO_NETWORK, BIN], env }),
  );
  return client;
}

const CALLS: [string, Record<string, unknown>][] = [
  ['list_projects', {}],
  ['get_sprint_issues', { boardId: 1, view: 'items' }],
  ['get_sprint_issues', { boardId: 1, sprint: 'last_closed' }],
  ['analyze_cycle_time', { boardId: 1 }],
  [
    'analyze_cycle_time',
    { boardId: 1, window: { from: '2026-09-01', to: '2026-11-11' }, groupBy: 'assignee' },
  ],
  ['find_blockers', { boardId: 1 }],
  ['assess_sprint_health', { boardId: 1 }],
  ['assess_sprint_health', { boardId: 1, sprint: { id: 4 } }],
];

describe('productops-jira on the demo dataset', () => {
  let client: Client;
  beforeAll(async () => {
    client = await connect();
  });
  afterAll(async () => {
    await client?.close();
  });

  it('lists the five read-only tools and the skill prompt', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual([
      'list_projects',
      'get_sprint_issues',
      'analyze_cycle_time',
      'find_blockers',
      'assess_sprint_health',
    ]);
    for (const t of tools) {
      expect(t.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      });
      expect(t.outputSchema).toBeDefined();
    }
    await expect(JSON.stringify(tools, null, 2) + '\n').toMatchFileSnapshot('./__snapshots__/tools.json');
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(['sprint-health-audit']);
  });

  it.each(CALLS)('%s %j returns schema-valid structured content', async (name, args) => {
    const r = await client.callTool({ name, arguments: args });
    expect(r.isError).toBeFalsy();
    expect(sc(r).meta.source).toMatchObject({
      mode: 'fixtures',
      fromCache: false,
      siteUrl: 'https://example.atlassian.net',
    });
    expect(sc(r).meta.source.upstreamCalls).toBeGreaterThan(0);
  });

  it('is deterministic apart from computedAt', async () => {
    for (const [name, args] of CALLS) {
      const a = sc(await client.callTool({ name, arguments: args }));
      const b = sc(await client.callTool({ name, arguments: args }));
      delete a.meta.computedAt;
      delete b.meta.computedAt;
      expect(b).toEqual(a);
    }
  });

  it('matches the demo story: an unhealthy active sprint', async () => {
    const h = sc(await client.callTool({ name: 'assess_sprint_health', arguments: { boardId: 1 } }));
    expect(h.sprint).toMatchObject({ id: 5, state: 'active' });
    expect(h.healthScore).toBe(43);
    const status = Object.fromEntries(h.checks.map((c: { id: string; status: string }) => [c.id, c.status]));
    expect(status).toEqual({
      BURNDOWN_LAG: 'warn',
      SCOPE_CREEP: 'warn',
      BLOCKERS: 'warn',
      WIP_OVERLOAD: 'risk',
      CYCLE_TIME_REGRESSION: 'warn',
      ESTIMATION_GAPS: 'warn',
      CARRY_OVER: 'warn',
    });
    for (const c of h.checks) if (c.status !== 'ok') expect(c.evidence.length).toBeGreaterThan(0);
  });

  it('sanitizes untrusted Jira text and warns about instruction-like content', async () => {
    const r = await client.callTool({ name: 'get_sprint_issues', arguments: { boardId: 1, view: 'items' } });
    const items = sc(r).items as { key: string; summary: { text: string; untrusted: boolean } }[];
    const injected = items.find((i) => /ignore previous/i.test(i.summary.text))!;
    expect(injected.summary.untrusted).toBe(true);
    expect(injected.summary.text).not.toMatch(/[\u{202A}-\u{202E}\u{2066}-\u{2069}]/u);
    expect(injected.summary.text).not.toContain('attacker.example');
    expect(sc(r).meta.warnings).toContainEqual(
      expect.objectContaining({ code: 'SUSPICIOUS_CONTENT', itemIds: [injected.key] }),
    );
  });

  it('never returns descriptions or comments', async () => {
    for (const [name, args] of CALLS) {
      const text = JSON.stringify(await client.callTool({ name, arguments: args }));
      expect(text).not.toMatch(/"(description|comments?|renderedFields)"\s*:/);
    }
  });

  it('reports unknown boards and missing sprints as NOT_FOUND', async () => {
    const missing = await client.callTool({ name: 'assess_sprint_health', arguments: { boardId: 99 } });
    expect(missing.isError).toBe(true);
    expect(sc(missing).error.code).toBe('NOT_FOUND');
    const kanban = await client.callTool({ name: 'find_blockers', arguments: { boardId: 2 } });
    expect(sc(kanban).error).toMatchObject({
      code: 'NOT_FOUND',
      hint: expect.stringContaining('last_closed'),
    });
  });

  it('rejects a date window longer than 180 days', async () => {
    const r = await client.callTool({
      name: 'analyze_cycle_time',
      arguments: { boardId: 1, window: { from: '2026-01-01', to: '2026-11-01' } },
    });
    expect(sc(r).error.code).toBe('VALIDATION_ERROR');
  });
});

describe('productops-jira configuration', () => {
  it('stops before reading when the call budget is too small', async () => {
    const client = await connect({ jira: { budget: { maxCallsPerTool: 20 } } });
    const r = await client.callTool({ name: 'assess_sprint_health', arguments: { boardId: 1 } });
    expect(sc(r).error).toMatchObject({ code: 'QUOTA_BUDGET_EXCEEDED', details: { limit: 20 } });
    await client.close();
  });

  it('hides people and filters projects', async () => {
    const client = await connect({ jira: { people: 'none', projects: { deny: ['OPS'] } } });
    const projects = sc(await client.callTool({ name: 'list_projects', arguments: {} }));
    expect(projects.projects.map((p: { key: string }) => p.key)).toEqual(['PAY']);
    const issues = sc(
      await client.callTool({ name: 'get_sprint_issues', arguments: { boardId: 1, view: 'items' } }),
    );
    expect(issues.items.every((i: { assignee: string | null }) => i.assignee === null)).toBe(true);
    await client.close();
  });

  it('hashes people consistently', async () => {
    const client = await connect({ jira: { people: 'hashed' } });
    const issues = sc(
      await client.callTool({ name: 'get_sprint_issues', arguments: { boardId: 1, view: 'items' } }),
    );
    const names = issues.items.map((i: { assignee: string | null }) => i.assignee).filter(Boolean);
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) expect(n).toMatch(/^person-[0-9a-f]{8}$/);
    await client.close();
  });
});

describe('productops-jira live mode without credentials', () => {
  it('asks the user to log in instead of touching the network', async () => {
    const home = mkdtempSync(join(tmpdir(), 'pohome-'));
    const client = await connect(undefined, { PRODUCTOPS_JIRA_MODE: 'live', PRODUCTOPS_HOME: home });
    const r = await client.callTool({ name: 'list_projects', arguments: {} });
    expect(r.isError).toBe(true);
    expect(sc(r).error).toMatchObject({
      code: 'AUTH_REQUIRED',
      hint: expect.stringContaining('productops-jira login'),
    });
    await client.close();
  });

  it('reports sign-in status on the command line', () => {
    const home = mkdtempSync(join(tmpdir(), 'pohome-'));
    const out = spawnSync(process.execPath, [BIN, 'status'], {
      env: { ...process.env, PRODUCTOPS_HOME: home },
    });
    expect(out.status).toBe(0);
    expect(out.stdout.toString()).toBe('');
    expect(out.stderr.toString()).toMatch(/Not signed in/);
  });
});
