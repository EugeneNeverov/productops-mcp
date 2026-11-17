import { readFileSync } from 'node:fs';
import * as z from 'zod/v4';
import { ToolPolicyConfig } from './policy.js';
import { ToolFailure } from '../schemas/errors.js';
import { HealthThresholds } from '../work/health.js';

/** `jira` section (spec §6.2, adjusted by ADR 0002: the budget counts upstream MCP calls). */
export const JiraConfig = z.object({
  /** `fixtures` serves the bundled demo data (demo, evals, CI); `live` reads the Atlassian MCP server. */
  mode: z.enum(['fixtures', 'live']).default('fixtures'),
  /** Fixture file for `mode: fixtures`; the bundled demo data when unset. */
  fixturesFile: z.string().optional(),
  /** Allowed site hostnames, e.g. "acme.atlassian.net". Empty = the first accessible site. */
  sites: z.array(z.string()).default([]),
  projects: ToolPolicyConfig.default({ allow: ['*'], deny: [] }),
  budget: z
    .object({ maxCallsPerTool: z.number().int().positive().default(600) })
    .default({ maxCallsPerTool: 600 }),
  returnText: z
    .object({ maxChars: z.number().int().min(20).max(2000).default(500) })
    .default({ maxChars: 500 }),
  people: z.enum(['displayName', 'hashed', 'none']).default('displayName'),
  blockedStatuses: z.array(z.string()).default(['Blocked']),
  fields: z.object({ storyPoints: z.string().optional() }).default({}),
  health: z
    .object({ thresholds: HealthThresholds.default(HealthThresholds.parse({})) })
    .default({ thresholds: HealthThresholds.parse({}) }),
});
export type JiraConfig = z.infer<typeof JiraConfig>;

/** productops.config.json (spec §6.2). */
export const ProductOpsConfig = z.object({
  tools: ToolPolicyConfig.default({ allow: ['*'], deny: [] }),
  writes: z.object({ enabled: z.literal(false).default(false) }).default({ enabled: false }),
  files: z
    .object({ allowedRoots: z.array(z.string()).default(['./data']) })
    .default({ allowedRoots: ['./data'] }),
  jira: JiraConfig.default(JiraConfig.parse({})),
  /** Local audit log (live Jira mode): one row per tool call, no arguments or content. */
  audit: z
    .object({
      enabled: z.boolean().default(true),
      retentionDays: z.number().int().min(1).max(365).default(30),
    })
    .default({ enabled: true, retentionDays: 30 }),
});
export type ProductOpsConfig = z.infer<typeof ProductOpsConfig>;

/** Loads the config from `PRODUCTOPS_CONFIG` (path) or returns defaults when it is unset. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ProductOpsConfig {
  const path = env.PRODUCTOPS_CONFIG;
  if (path === undefined || path === '') return ProductOpsConfig.parse({});
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new ToolFailure('VALIDATION_ERROR', `Cannot read config file ${path}: ${(err as Error).message}`);
  }
  const result = ProductOpsConfig.safeParse(raw);
  if (!result.success) {
    throw new ToolFailure('VALIDATION_ERROR', `Invalid config file ${path}`, {
      details: { issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
    });
  }
  return result.data;
}
