import { readFileSync } from 'node:fs';
import * as z from 'zod/v4';
import { ToolPolicyConfig } from './policy.js';
import { ToolFailure } from '../schemas/errors.js';

/**
 * productops.config.json (spec §6.2). Stage 1 covers the sections shared by every server;
 * the `jira` section is added in stage 4.
 */
export const ProductOpsConfig = z.object({
  tools: ToolPolicyConfig.default({ allow: ['*'], deny: [] }),
  writes: z.object({ enabled: z.literal(false).default(false) }).default({ enabled: false }),
  files: z
    .object({ allowedRoots: z.array(z.string()).default(['./data']) })
    .default({ allowedRoots: ['./data'] }),
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
