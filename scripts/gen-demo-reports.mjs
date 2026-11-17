#!/usr/bin/env node
// Regenerates examples/reports/demo/*.json: the reference outputs of every prioritization tool
// on the bundled demo dataset. The e2e suite fails when the server's output drifts from them.
// Usage: pnpm build && node scripts/gen-demo-reports.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const requests = JSON.parse(
  readFileSync(new URL('../packages/mcp-prioritization/test/demo-requests.json', import.meta.url), 'utf8'),
);
const client = new Client({ name: 'gen-demo-reports', version: '0' });
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('../packages/mcp-prioritization/dist/bin.js', import.meta.url))],
    env: { PRODUCTOPS_LOG_LEVEL: 'silent' },
  }),
);
for (const [tool, args] of Object.entries(requests)) {
  if (tool.startsWith('_')) continue;
  const result = await client.callTool({ name: tool, arguments: args });
  if (result.isError) throw new Error(`${tool} failed: ${JSON.stringify(result.structuredContent)}`);
  const { meta, ...rest } = result.structuredContent;
  const stable = {
    request: args,
    response: { ...rest, meta: { tool: meta.tool, inputHash: meta.inputHash, warnings: meta.warnings } },
  };
  writeFileSync(
    new URL(`../examples/reports/demo/${tool}.json`, import.meta.url),
    JSON.stringify(stable, null, 2) + '\n',
  );
  console.log(`wrote ${tool}.json`);
}
await client.close();
