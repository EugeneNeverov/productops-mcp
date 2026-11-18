import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const BIN = fileURLToPath(new URL('../dist/bin.js', import.meta.url));
// --import takes a URL; a bare Windows path (C:\...) would be read as the scheme "c:".
const NO_NETWORK = pathToFileURL(fileURLToPath(new URL('./no-network.mjs', import.meta.url))).href;
const REQUESTS = JSON.parse(readFileSync(new URL('./demo-requests.json', import.meta.url), 'utf8')) as Record<
  string,
  Record<string, unknown>
>;
const REPORTS = new URL('../../../examples/reports/demo/', import.meta.url);
const TOOLS = Object.keys(REQUESTS).filter((k) => !k.startsWith('_'));

type Result = { isError?: boolean; structuredContent?: unknown };
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose access to tool JSON in assertions
const sc = (r: Result) => r.structuredContent as Record<string, any>;

async function connect(env: Record<string, string> = {}, nodeArgs: string[] = []) {
  const client = new Client({ name: 'e2e', version: '0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [...nodeArgs, BIN],
    env: { PRODUCTOPS_LOG_LEVEL: 'silent', ...env },
    stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));
  await client.connect(transport);
  return { client, stderr: () => stderr };
}

describe('prioritization tools', () => {
  let c: Awaited<ReturnType<typeof connect>>;
  beforeAll(async () => {
    c = await connect({ PRODUCTOPS_LOG_LEVEL: 'warn' }, ['--import', NO_NETWORK]);
  });
  afterAll(async () => {
    await c.client.close();
  });

  it('publishes stable tool schemas (contract snapshot)', async () => {
    const { tools } = await c.client.listTools();
    expect(tools.map((t) => t.name)).toEqual([
      'ping',
      'calculate_rice',
      'calculate_wsjf',
      'compare_initiatives',
      'simulate_capacity',
      'explain_ranking',
    ]);
    for (const t of tools)
      expect(t.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      });
    await expect(JSON.stringify(tools, null, 2) + '\n').toMatchFileSnapshot('./__snapshots__/tools.json');
  });

  it.each(TOOLS)('%s matches the reference output in examples/reports/demo', async (tool) => {
    const result = (await c.client.callTool({ name: tool, arguments: REQUESTS[tool] })) as Result;
    expect(result.isError).toBeFalsy();
    const { meta, ...rest } = sc(result);
    const reference = JSON.parse(readFileSync(new URL(`${tool}.json`, REPORTS), 'utf8'));
    expect({
      ...rest,
      meta: { tool: meta.tool, inputHash: meta.inputHash, warnings: meta.warnings },
    }).toEqual(reference.response);
  });

  it('is deterministic: two calls give identical output apart from computedAt', async () => {
    for (const tool of TOOLS) {
      const a = sc((await c.client.callTool({ name: tool, arguments: REQUESTS[tool] })) as Result);
      const b = sc((await c.client.callTool({ name: tool, arguments: REQUESTS[tool] })) as Result);
      delete a.meta.computedAt;
      delete b.meta.computedAt;
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  it('never touches the network', () => {
    expect(c.stderr()).not.toContain('NETWORK_ATTEMPT');
  });

  it('returns ToolError results for bad business input', async () => {
    const cycle = await c.client.callTool({
      name: 'simulate_capacity',
      arguments: {
        initiatives: {
          kind: 'inline',
          items: [
            { id: 'a', title: 'A', reach: 1, impact: 1, confidence: 1, effort: 1, dependsOn: ['b'] },
            { id: 'b', title: 'B', reach: 1, impact: 1, confidence: 1, effort: 1, dependsOn: ['a'] },
          ],
        },
        capacity: [{ team: '*', amount: 5 }],
      },
    });
    expect(cycle.isError).toBe(true);
    expect(sc(cycle as Result).error).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { cycle: ['a', 'b', 'a'] },
    });

    const incomplete = await c.client.callTool({
      name: 'calculate_rice',
      arguments: { initiatives: { kind: 'inline', items: [{ id: 'a', title: 'A', reach: 1 }] } },
    });
    expect(sc(incomplete as Result).error.code).toBe('VALIDATION_ERROR');

    const lenient = await c.client.callTool({
      name: 'calculate_rice',
      arguments: {
        initiatives: { kind: 'inline', items: [{ id: 'a', title: 'A', reach: 1 }] },
        options: { strict: false },
      },
    });
    expect(sc(lenient as Result).items[0]).toMatchObject({ id: 'a', excluded: true, rank: null });
    expect(sc(lenient as Result).meta.warnings[0].code).toBe('EXCLUDED_INCOMPLETE');
  });

  it('ranks 500 initiatives quickly', async () => {
    const items = Array.from({ length: 500 }, (_, i) => ({
      id: `i${i}`,
      title: `Item ${i}`,
      reach: (i * 7919) % 10_000,
      impact: [0.25, 0.5, 1, 2, 3][i % 5],
      confidence: [0.5, 0.8, 1][i % 3],
      effort: (i % 8) + 0.5,
      businessValue: [1, 2, 3, 5, 8, 13, 20][i % 7],
      timeCriticality: [1, 2, 3, 5, 8, 13, 20][(i * 3) % 7],
      riskReductionOpportunity: [1, 2, 3, 5, 8, 13, 20][(i * 5) % 7],
      jobSize: [1, 2, 3, 5, 8, 13, 20][(i * 2) % 7],
    }));
    const started = performance.now();
    const r = await c.client.callTool({
      name: 'compare_initiatives',
      arguments: { initiatives: { kind: 'inline', items } },
    });
    const ms = performance.now() - started;
    expect(r.isError).toBeFalsy();
    expect(sc(r as Result).rankings.RICE).toHaveLength(500);
    expect(ms).toBeLessThan(2000); // end-to-end incl. JSON over stdio; the calculation itself is far below the 200 ms budget
  });
});

describe('file sources and config', () => {
  it('reads files only inside allowedRoots from the config', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'po-e2e-'));
    writeFileSync(
      join(dir, 'backlog.csv'),
      'id,title,reach,impact,confidence,effort\na,A,100,1,1,1\nb,B,50,1,1,1\n',
    );
    writeFileSync(
      join(dir, 'productops.config.json'),
      JSON.stringify({ files: { allowedRoots: ['.'] }, tools: { deny: ['calculate_wsjf'] } }),
    );
    const c = await connect({ PRODUCTOPS_CONFIG: join(dir, 'productops.config.json') });
    try {
      const ok = sc(
        (await c.client.callTool({
          name: 'calculate_rice',
          arguments: { initiatives: { kind: 'file', path: 'backlog.csv' } },
        })) as Result,
      );
      expect(ok.items.map((i: { id: string }) => i.id)).toEqual(['a', 'b']);
      const escape = sc(
        (await c.client.callTool({
          name: 'calculate_rice',
          arguments: { initiatives: { kind: 'file', path: '../../etc/passwd' } },
        })) as Result,
      );
      expect(escape.error.code).toBe('FILE_NOT_ALLOWED');
      const denied = sc(
        (await c.client.callTool({
          name: 'calculate_wsjf',
          arguments: { initiatives: { kind: 'demo' } },
        })) as Result,
      );
      expect(denied.error.code).toBe('PERMISSION_DENIED');
    } finally {
      await c.client.close();
    }
  });

  it('also allows the folder in PRODUCTOPS_DATA_DIR', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'po-e2e-'));
    writeFileSync(join(dir, 'backlog.csv'), 'id,title,reach,impact,confidence,effort\na,A,100,1,1,1\n');
    const c = await connect({ PRODUCTOPS_DATA_DIR: dir });
    try {
      const ok = sc(
        (await c.client.callTool({
          name: 'calculate_rice',
          arguments: { initiatives: { kind: 'file', path: join(dir, 'backlog.csv') } },
        })) as Result,
      );
      expect(ok.items.map((i: { id: string }) => i.id)).toEqual(['a']);
    } finally {
      await c.client.close();
    }
  });

  it('exits with a clear error on an invalid config', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'po-e2e-'));
    writeFileSync(join(dir, 'c.json'), JSON.stringify({ writes: { enabled: true } }));
    const child = spawn(process.execPath, [BIN], {
      env: { ...process.env, PRODUCTOPS_CONFIG: join(dir, 'c.json') },
    });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    const code = await new Promise((r) => child.once('exit', r));
    expect(code).not.toBe(0);
    expect(stderr).toContain('Invalid config');
  });
});

describe('method resources', () => {
  it('serves RICE and WSJF references', async () => {
    const c = await connect();
    try {
      const { resources } = await c.client.listResources();
      expect(resources.map((r) => r.uri).sort()).toEqual([
        'productops://methods/rice',
        'productops://methods/wsjf',
      ]);
      const rice = await c.client.readResource({ uri: 'productops://methods/rice' });
      expect((rice.contents[0] as { text: string }).text).toContain('(reach × impact × confidence) / effort');
    } finally {
      await c.client.close();
    }
  });
});

describe('roadmap-prioritization prompt', () => {
  it('serves the skill as an MCP prompt with the task filled in', async () => {
    const c = await connect();
    try {
      const { prompts } = await c.client.listPrompts();
      expect(prompts.map((p) => p.name)).toEqual(['roadmap-prioritization']);
      expect(prompts[0]!.description).toContain('Prioritize a product backlog');
      const p = await c.client.getPrompt({
        name: 'roadmap-prioritization',
        arguments: { source: 'demo', capacity: 'Growth 10, Platform 12, Mobile 12' },
      });
      const text = (p.messages[0]!.content as { text: string }).text;
      expect(text).toContain('Never compute a score');
      expect(text).toContain('## Reproducibility');
      expect(text).toContain('Capacity: Growth 10, Platform 12, Mobile 12');
      expect(text).not.toMatch(/^---\nname:/);
    } finally {
      await c.client.close();
    }
  });
});
