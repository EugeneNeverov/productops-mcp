import * as z from 'zod/v4';
import {
  loadInitiatives,
  type Initiative,
  type InitiativesSource,
  type ToolContext,
} from '@productops-mcp/core';

export interface ToolEnv {
  allowedRoots: string[];
  demoFiles: Record<string, string>;
}

export function load(env: ToolEnv, source: InitiativesSource, ctx: ToolContext): Initiative[] {
  return loadInitiatives(source, {
    allowedRoots: env.allowedRoots,
    demoFiles: env.demoFiles,
    warn: ctx.warn,
  });
}

export const ScoredItem = z.object({
  id: z.string(),
  title: z.string(),
  score: z.number().nullable(),
  rank: z.number().int().positive().nullable(),
  components: z.record(z.string(), z.number()),
  excluded: z.boolean(),
  excludedReason: z.string().optional(),
});

export const ScoreSummary = z.object({
  count: z.number().int(),
  excludedCount: z.number().int(),
  scoreMin: z.number().nullable(),
  scoreMedian: z.number().nullable(),
  scoreMax: z.number().nullable(),
});

export const CustomInput = z
  .object({
    weights: z
      .record(z.string(), z.number())
      .refine((w) => Object.keys(w).length > 0, 'at least one weight')
      .describe('Field → weight, e.g. {"reach": 2, "effort": 1}'),
    invert: z.array(z.string()).default(['effort', 'jobSize']).describe('Fields where lower is better'),
  })
  .describe('Weighted sum of min-max normalized fields');

export const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export function topList(
  items: { id: string; title: string; score: number | null; rank: number | null }[],
  n = 5,
): string {
  return items
    .filter((i) => i.rank !== null)
    .slice(0, n)
    .map((i) => `${i.rank}. ${i.title} (${i.id}) — ${i.score}`)
    .join('\n');
}
