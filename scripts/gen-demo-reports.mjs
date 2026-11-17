#!/usr/bin/env node
// Regenerates the reference outputs of the tools on the bundled demo datasets:
//   examples/reports/demo/*.json       prioritization server
//   examples/reports/jira-demo/*.json  Jira server (fixtures mode)
// The e2e suites fail when a server's output drifts from them, and the eval checks are tested
// against the example reports written from them.
// Usage: pnpm build && node scripts/gen-demo-reports.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const SETS = [
  { pkg: 'mcp-prioritization', out: 'demo' },
  { pkg: 'mcp-jira', out: 'jira-demo' },
];

for (const { pkg, out } of SETS) {
  const requests = JSON.parse(
    readFileSync(new URL(`../packages/${pkg}/test/demo-requests.json`, import.meta.url), 'utf8'),
  );
  const client = new Client({ name: 'gen-demo-reports', version: '0' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL(`../packages/${pkg}/dist/bin.js`, import.meta.url))],
      env: { PRODUCTOPS_LOG_LEVEL: 'silent' },
    }),
  );
  const dir = new URL(`../examples/reports/${out}/`, import.meta.url);
  mkdirSync(dir, { recursive: true });
  for (const [tool, args] of Object.entries(requests)) {
    if (tool.startsWith('_')) continue;
    const result = await client.callTool({ name: tool, arguments: args });
    if (result.isError) throw new Error(`${tool} failed: ${JSON.stringify(result.structuredContent)}`);
    const { meta, ...rest } = result.structuredContent;
    const stable = {
      request: args,
      response: { ...rest, meta: { tool: meta.tool, inputHash: meta.inputHash, warnings: meta.warnings } },
    };
    writeFileSync(new URL(`${tool}.json`, dir), JSON.stringify(stable, null, 2) + '\n');
    console.log(`wrote ${out}/${tool}.json`);
  }
  await client.close();
}
