import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/server';
import {
  createLogger,
  createToolPolicy,
  loadConfig,
  withToolRuntime,
  type Logger,
  type ProductOpsConfig,
  type RuntimeDeps,
} from '@productops/core';
import { createPingHandler, PingInput, PingOutput } from './tools/ping.js';

export const SERVER_NAME = 'productops-prioritization';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
};
export const SERVER_VERSION = pkg.version;

export interface ServerDeps {
  config: ProductOpsConfig;
  logger: Logger;
  now?: () => Date;
}

export function loadDeps(): ServerDeps {
  return { config: loadConfig(), logger: createLogger({ name: SERVER_NAME }) };
}

export function createServer(deps: ServerDeps): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  const runtime: RuntimeDeps = {
    version: SERVER_VERSION,
    logger: deps.logger,
    policy: createToolPolicy(deps.config.tools),
    ...(deps.now ? { now: deps.now } : {}),
  };

  server.registerTool(
    'ping',
    {
      title: 'Ping',
      description: 'Health check. Echoes a message back with the server name and version.',
      inputSchema: PingInput,
      outputSchema: PingOutput,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    withToolRuntime('ping', runtime, createPingHandler({ name: SERVER_NAME, version: SERVER_VERSION })),
  );

  return server;
}
