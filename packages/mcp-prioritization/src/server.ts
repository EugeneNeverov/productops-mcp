import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
import { READ_ONLY, type ToolEnv } from './tools/common.js';
import { CalculateRiceInput, CalculateRiceOutput, createRiceHandler, riceDescription } from './tools/rice.js';
import { CalculateWsjfInput, CalculateWsjfOutput, createWsjfHandler, wsjfDescription } from './tools/wsjf.js';
import { CompareInput, CompareOutput, compareDescription, createCompareHandler } from './tools/compare.js';
import {
  capacityDescription,
  createCapacityHandler,
  SimulateCapacityInput,
  SimulateCapacityOutput,
} from './tools/capacity.js';
import {
  createExplainHandler,
  explainDescription,
  ExplainRankingInput,
  ExplainRankingOutput,
} from './tools/explain.js';
import { createPingHandler, PingInput, PingOutput } from './tools/ping.js';
import { METHOD_RESOURCES } from './resources.js';
import { loadRoadmapSkill, RoadmapPromptArgs, roadmapPromptText } from './prompts.js';

export const SERVER_NAME = 'productops-prioritization';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
};
export const SERVER_VERSION = pkg.version;

export const DEMO_FILES: Record<string, string> = {
  'saas-roadmap': fileURLToPath(new URL('../demo-data/saas-roadmap.csv', import.meta.url)),
};

export interface ServerDeps {
  config: ProductOpsConfig;
  logger: Logger;
  /** Absolute directories that file sources may read from. */
  allowedRoots: string[];
  now?: () => Date;
}

/**
 * Relative allowedRoots resolve against the config file's directory when PRODUCTOPS_CONFIG is set,
 * otherwise against the working directory the client started the server in.
 */
export function loadDeps(env: NodeJS.ProcessEnv = process.env): ServerDeps {
  const config = loadConfig(env);
  const base = env.PRODUCTOPS_CONFIG ? dirname(resolve(env.PRODUCTOPS_CONFIG)) : process.cwd();
  return {
    config,
    logger: createLogger({ name: SERVER_NAME }),
    allowedRoots: config.files.allowedRoots.map((r) => resolve(base, r)),
  };
}

export function createServer(deps: ServerDeps): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  const runtime: RuntimeDeps = {
    version: SERVER_VERSION,
    logger: deps.logger,
    policy: createToolPolicy(deps.config.tools),
    ...(deps.now ? { now: deps.now } : {}),
  };
  const env: ToolEnv = { allowedRoots: deps.allowedRoots, demoFiles: DEMO_FILES };

  server.registerTool(
    'ping',
    {
      title: 'Ping',
      description: 'Health check. Echoes a message back with the server name and version.',
      inputSchema: PingInput,
      outputSchema: PingOutput,
      annotations: READ_ONLY,
    },
    withToolRuntime('ping', runtime, createPingHandler({ name: SERVER_NAME, version: SERVER_VERSION })),
  );
  server.registerTool(
    'calculate_rice',
    {
      title: 'Calculate RICE scores',
      description: riceDescription,
      inputSchema: CalculateRiceInput,
      outputSchema: CalculateRiceOutput,
      annotations: READ_ONLY,
    },
    withToolRuntime('calculate_rice', runtime, createRiceHandler(env)),
  );
  server.registerTool(
    'calculate_wsjf',
    {
      title: 'Calculate WSJF scores',
      description: wsjfDescription,
      inputSchema: CalculateWsjfInput,
      outputSchema: CalculateWsjfOutput,
      annotations: READ_ONLY,
    },
    withToolRuntime('calculate_wsjf', runtime, createWsjfHandler(env)),
  );
  server.registerTool(
    'compare_initiatives',
    {
      title: 'Compare prioritization methods',
      description: compareDescription,
      inputSchema: CompareInput,
      outputSchema: CompareOutput,
      annotations: READ_ONLY,
    },
    withToolRuntime('compare_initiatives', runtime, createCompareHandler(env)),
  );
  server.registerTool(
    'simulate_capacity',
    {
      title: 'Simulate capacity scenarios',
      description: capacityDescription,
      inputSchema: SimulateCapacityInput,
      outputSchema: SimulateCapacityOutput,
      annotations: READ_ONLY,
    },
    withToolRuntime('simulate_capacity', runtime, createCapacityHandler(env)),
  );
  server.registerTool(
    'explain_ranking',
    {
      title: 'Explain a ranking',
      description: explainDescription,
      inputSchema: ExplainRankingInput,
      outputSchema: ExplainRankingOutput,
      annotations: READ_ONLY,
    },
    withToolRuntime('explain_ranking', runtime, createExplainHandler(env)),
  );

  for (const [name, r] of Object.entries(METHOD_RESOURCES)) {
    server.registerResource(
      `method-${name}`,
      r.uri,
      { title: r.title, mimeType: 'text/markdown' },
      async (uri) => ({
        contents: [{ uri: uri.href, mimeType: 'text/markdown', text: r.text }],
      }),
    );
  }

  const skill = loadRoadmapSkill();
  server.registerPrompt(
    'roadmap-prioritization',
    { title: 'Roadmap prioritization', description: skill.description, argsSchema: RoadmapPromptArgs },
    (args) => ({
      messages: [
        { role: 'user' as const, content: { type: 'text' as const, text: roadmapPromptText(skill, args) } },
      ],
    }),
  );

  return server;
}
