import * as z from 'zod/v4';
import {
  assertComplete,
  InitiativesSource,
  Meta,
  rank,
  riceScore,
  scoreSummary,
  toScoredItemOut,
  type ToolContext,
} from '@productops-mcp/core';
import { load, ScoredItem, ScoreSummary, topList, type ToolEnv } from './common.js';

export const CalculateRiceInput = z.object({
  initiatives: InitiativesSource,
  options: z
    .object({
      strict: z
        .boolean()
        .default(true)
        .describe('false: items with missing fields are excluded with a warning'),
      effortUnit: z.enum(['person-months', 'person-weeks', 'story-points']).default('person-months'),
      reachPeriod: z.string().max(32).default('quarter').describe('Label only'),
    })
    .default({ strict: true, effortUnit: 'person-months', reachPeriod: 'quarter' }),
});
export type CalculateRiceInput = z.infer<typeof CalculateRiceInput>;

export const CalculateRiceOutput = z.object({
  method: z.literal('RICE'),
  formula: z.string(),
  units: z.object({ effort: z.string(), reachPeriod: z.string() }),
  items: z.array(ScoredItem),
  summary: ScoreSummary,
  meta: Meta,
});

export const riceDescription =
  'Score initiatives with RICE = (reach × impact × confidence) / effort and rank them. ' +
  'Deterministic; ties break by lower effort, then id. Use this instead of computing scores yourself.';

export function createRiceHandler(env: ToolEnv) {
  return async (input: CalculateRiceInput, ctx: ToolContext) => {
    const items = load(env, input.initiatives, ctx);
    const scores = items.map(riceScore);
    if (input.options.strict) assertComplete(scores, 'RICE');
    const ranked = rank(scores);
    const excluded = ranked.filter((r) => r.score === null).map((r) => r.item.id);
    if (excluded.length > 0) {
      ctx.warn({
        code: 'EXCLUDED_INCOMPLETE',
        message: `${excluded.length} item(s) lack RICE fields and were not ranked.`,
        itemIds: excluded,
      });
    }
    const low = ranked.filter((r) => r.score !== null && r.item.confidence! < 0.5).map((r) => r.item.id);
    if (low.length > 0)
      ctx.warn({
        code: 'LOW_CONFIDENCE',
        message: 'Confidence below 50%: treat these scores as rough.',
        itemIds: low,
      });
    const out = ranked.map(toScoredItemOut);
    return {
      data: {
        method: 'RICE' as const,
        formula: '(reach × impact × confidence) / effort',
        units: { effort: input.options.effortUnit, reachPeriod: input.options.reachPeriod },
        items: out,
        summary: scoreSummary(ranked),
      },
      summary: `RICE ranking of ${out.length} initiatives. Top:\n${topList(out)}`,
    };
  };
}
