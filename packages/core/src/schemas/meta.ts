import * as z from 'zod/v4';

export const Warning = z.object({
  code: z.string(),
  message: z.string(),
  itemIds: z.array(z.string()).optional(),
});
export type Warning = z.infer<typeof Warning>;

/**
 * Source block, present only for tools that read an external system (Jira).
 * Upstream calls are calls to the Atlassian MCP server, which cost the customer Rovo credits (ADR 0002).
 */
export const SourceInfo = z.object({
  mode: z.enum(['live', 'fixtures']),
  cloudId: z.string(),
  siteUrl: z.string().url(),
  fromCache: z.boolean(),
  fetchedAt: z.string().datetime(),
  upstreamCalls: z.number().int(),
});
export type SourceInfo = z.infer<typeof SourceInfo>;

/** Block attached to every successful tool result (spec §3.2). */
export const Meta = z.object({
  tool: z.string(),
  version: z.string(),
  computedAt: z.string().datetime(),
  inputHash: z.string(),
  warnings: z.array(Warning),
  source: SourceInfo.optional(),
});
export type Meta = z.infer<typeof Meta>;
