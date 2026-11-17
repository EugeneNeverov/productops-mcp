#!/usr/bin/env node
// Minimal MCP test client: starts a built server over stdio, lists its tools and calls one.
// The server gets this process's environment (the SDK forwards only a few variables by default),
// so PRODUCTOPS_JIRA_MODE, PRODUCTOPS_HOME and PRODUCTOPS_CONFIG reach it.
// Usage: node scripts/test-client.mjs [server-bin] [tool] [json-args]
//   pnpm client                                   -> ping on the prioritization server
//   pnpm client packages/mcp-prioritization/dist/bin.js ping '{"message":"hi"}'
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const [bin = 'packages/mcp-prioritization/dist/bin.js', tool = 'ping', rawArgs = '{}'] =
  process.argv.slice(2);

const client = new Client({ name: 'productops-test-client', version: '0.0.0' });
await client.connect(
  new StdioClientTransport({ command: process.execPath, args: [bin], stderr: 'inherit', env: process.env }),
);
try {
  const { tools } = await client.listTools();
  console.log(`Tools (${tools.length}): ${tools.map((t) => t.name).join(', ')}`);
  const result = await client.callTool({ name: tool, arguments: JSON.parse(rawArgs) });
  console.log(JSON.stringify(result.structuredContent ?? result.content, null, 2));
  process.exitCode = result.isError ? 1 : 0;
} finally {
  await client.close();
}
