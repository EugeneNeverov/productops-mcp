import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const BIN = fileURLToPath(new URL('../dist/bin.js', import.meta.url));

describe('productops-prioritization over stdio', () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ name: 'e2e', version: '0.0.0' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [BIN],
        env: { PRODUCTOPS_LOG_LEVEL: 'silent' },
      }),
    );
  });
  afterAll(async () => {
    await client?.close();
  });

  it('lists ping as a read-only tool with input and output schemas', async () => {
    const { tools } = await client.listTools();
    const ping = tools.find((t) => t.name === 'ping');
    expect(ping?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(ping?.outputSchema).toBeDefined();
  });

  it('answers ping with structured content', async () => {
    const result = await client.callTool({ name: 'ping', arguments: { message: 'hello' } });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      pong: 'hello',
      server: { name: 'productops-prioritization' },
      meta: { tool: 'ping', warnings: [] },
    });
  });

  it('returns isError for input that violates the schema', async () => {
    const result = await client.callTool({ name: 'ping', arguments: { message: 'x'.repeat(201) } });
    expect(result.isError).toBe(true);
  });
});

describe('stdout hygiene', () => {
  it('writes only JSON-RPC messages to stdout while logging to stderr', async () => {
    const child = spawn(process.execPath, [BIN], { env: { ...process.env, PRODUCTOPS_LOG_LEVEL: 'debug' } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));

    const send = (msg: object) => child.stdin.write(JSON.stringify(msg) + '\n');
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'raw', version: '0' } },
    });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'ping', arguments: {} } });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no response; stderr: ${stderr}`)), 10_000);
      child.stdout.on('data', () => {
        if (stdout.includes('"id":2')) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    child.stdin.end();
    await new Promise((r) => child.once('exit', r));

    const lines = stdout.split('\n').filter((l) => l.trim() !== '');
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const line of lines) expect(JSON.parse(line)).toMatchObject({ jsonrpc: '2.0' });
    expect(stderr).toContain('"msg":"server started"');
    expect(stderr).toContain('"msg":"tool ok"');
  });
});
