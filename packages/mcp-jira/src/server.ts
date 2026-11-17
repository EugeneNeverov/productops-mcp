import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/server';
import {
  createLogger,
  createToolPolicy,
  loadConfig,
  ToolFailure,
  withToolRuntime,
  type Logger,
  type ProductOpsConfig,
  type RuntimeDeps,
} from '@productops/core';
import { DEMO_FIXTURES, FixtureSource, loadFixtureFile } from './source/fixtures.js';
import { Normalizer } from './source/normalize.js';
import type { JiraSource } from './source/types.js';
import { JIRA_READ, type JiraEnv } from './tools/common.js';
import {
  createListProjectsHandler,
  ListProjectsInput,
  ListProjectsOutput,
  listProjectsDescription,
} from './tools/projects.js';
import {
  createGetSprintIssuesHandler,
  GetSprintIssuesInput,
  GetSprintIssuesOutput,
  getSprintIssuesDescription,
} from './tools/sprintIssues.js';
import {
  AnalyzeCycleTimeInput,
  AnalyzeCycleTimeOutput,
  analyzeCycleTimeDescription,
  createAnalyzeCycleTimeHandler,
} from './tools/cycleTime.js';
import {
  createFindBlockersHandler,
  FindBlockersInput,
  FindBlockersOutput,
  findBlockersDescription,
} from './tools/blockers.js';
import {
  AssessSprintHealthInput,
  AssessSprintHealthOutput,
  assessSprintHealthDescription,
  createAssessSprintHealthHandler,
} from './tools/health.js';
import { loadSprintSkill, SprintPromptArgs, sprintPromptText } from './prompts.js';

export const SERVER_NAME = 'productops-jira';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
};
export const SERVER_VERSION = pkg.version;

export interface ServerDeps {
  config: ProductOpsConfig;
  logger: Logger;
  source: JiraSource;
  now?: () => Date;
}

/**
 * Mode comes from PRODUCTOPS_JIRA_MODE, else jira.mode in the config (default "fixtures").
 * A relative fixturesFile resolves against the config file's directory.
 */
export function loadDeps(env: NodeJS.ProcessEnv = process.env): ServerDeps {
  const config = loadConfig(env);
  const mode = (env.PRODUCTOPS_JIRA_MODE || config.jira.mode) as string;
  const logger = createLogger({ name: SERVER_NAME });
  const normalizer = new Normalizer(config.jira);
  if (mode === 'fixtures') {
    const base = env.PRODUCTOPS_CONFIG ? dirname(resolve(env.PRODUCTOPS_CONFIG)) : process.cwd();
    const file = config.jira.fixturesFile ? resolve(base, config.jira.fixturesFile) : DEMO_FIXTURES;
    return { config, logger, source: new FixtureSource(loadFixtureFile(file), normalizer) };
  }
  if (mode === 'live') {
    throw new ToolFailure(
      'VALIDATION_ERROR',
      'Live mode (Atlassian MCP) is not available in this build yet.',
      {
        hint: 'Use PRODUCTOPS_JIRA_MODE=fixtures for the demo data.',
      },
    );
  }
  throw new ToolFailure('VALIDATION_ERROR', `Unknown Jira mode "${mode}". Use "fixtures" or "live".`);
}

export function createServer(deps: ServerDeps): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  const runtime: RuntimeDeps = {
    version: SERVER_VERSION,
    logger: deps.logger,
    policy: createToolPolicy(deps.config.tools),
    ...(deps.now ? { now: deps.now } : {}),
  };
  const env: JiraEnv = { source: deps.source, config: deps.config.jira };
  server.registerTool(
    'list_projects',
    {
      title: 'List Jira projects',
      description: listProjectsDescription,
      inputSchema: ListProjectsInput,
      outputSchema: ListProjectsOutput,
      annotations: JIRA_READ,
    },
    withToolRuntime('list_projects', runtime, createListProjectsHandler(env)),
  );
  server.registerTool(
    'get_sprint_issues',
    {
      title: 'Get sprint issues',
      description: getSprintIssuesDescription,
      inputSchema: GetSprintIssuesInput,
      outputSchema: GetSprintIssuesOutput,
      annotations: JIRA_READ,
    },
    withToolRuntime('get_sprint_issues', runtime, createGetSprintIssuesHandler(env)),
  );
  server.registerTool(
    'analyze_cycle_time',
    {
      title: 'Analyze cycle time',
      description: analyzeCycleTimeDescription,
      inputSchema: AnalyzeCycleTimeInput,
      outputSchema: AnalyzeCycleTimeOutput,
      annotations: JIRA_READ,
    },
    withToolRuntime('analyze_cycle_time', runtime, createAnalyzeCycleTimeHandler(env)),
  );
  server.registerTool(
    'find_blockers',
    {
      title: 'Find blockers',
      description: findBlockersDescription,
      inputSchema: FindBlockersInput,
      outputSchema: FindBlockersOutput,
      annotations: JIRA_READ,
    },
    withToolRuntime('find_blockers', runtime, createFindBlockersHandler(env)),
  );
  server.registerTool(
    'assess_sprint_health',
    {
      title: 'Assess sprint health',
      description: assessSprintHealthDescription,
      inputSchema: AssessSprintHealthInput,
      outputSchema: AssessSprintHealthOutput,
      annotations: JIRA_READ,
    },
    withToolRuntime('assess_sprint_health', runtime, createAssessSprintHealthHandler(env)),
  );

  const skill = loadSprintSkill();
  server.registerPrompt(
    'sprint-health-audit',
    { title: 'Sprint health audit', description: skill.description, argsSchema: SprintPromptArgs },
    (args) => ({
      messages: [
        { role: 'user' as const, content: { type: 'text' as const, text: sprintPromptText(skill, args) } },
      ],
    }),
  );
  return server;
}
