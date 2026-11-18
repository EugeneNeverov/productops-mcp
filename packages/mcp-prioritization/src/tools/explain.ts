import * as z from 'zod/v4';
import { explainRanking, InitiativesSource, Meta, type ToolContext } from '@productops-mcp/core';
import { load, type ToolEnv } from './common.js';

export const ExplainRankingInput = z.object({
  initiatives: InitiativesSource,
  method: z.enum(['RICE', 'WSJF']),
  ids: z.array(z.string()).min(1).max(10).describe('Initiatives to explain'),
  compareWith: z
    .enum(['neighbors', 'top1', 'none'])
    .default('neighbors')
    .describe('neighbors: items ranked just above and below; top1: the #1 item'),
});
export type ExplainRankingInput = z.infer<typeof ExplainRankingInput>;

const Change = z.object({ requiredValue: z.number(), changePct: z.number() });

export const ExplainRankingOutput = z.object({
  method: z.enum(['RICE', 'WSJF']),
  explanations: z.array(
    z.object({
      id: z.string(),
      rank: z.number().int(),
      score: z.number(),
      contributions: z.array(
        z.object({
          component: z.string(),
          value: z.number(),
          vsMedian: z.number().describe('ln(value / set median); positive = pushes the score up'),
          logShare: z.number().describe('Share of this component in the distance from a median item'),
        }),
      ),
      costOfDelayBreakdown: z.record(z.string(), z.number()).optional(),
      sensitivity: z.array(
        z.object({
          component: z.string(),
          toOvertake: Change.extend({ targetId: z.string() }).nullable(),
          toBeOvertaken: z
            .object({ byId: z.string(), thresholdValue: z.number(), changePct: z.number() })
            .nullable(),
        }),
      ),
      flags: z.array(
        z.enum(['LOW_CONFIDENCE', 'HIGH_EFFORT_OUTLIER', 'SINGLE_COMPONENT_DOMINATES', 'NEAR_TIE']),
      ),
    }),
  ),
  meta: Meta,
});

export const explainDescription =
  'Explain why specific initiatives rank where they do: which components push them up or down versus a ' +
  'median item, and the smallest single-component change that would move them past a neighbour (verified ' +
  'by re-ranking). Use this output for trade-off explanations instead of reasoning about the numbers yourself.';

export function createExplainHandler(env: ToolEnv) {
  return async (input: ExplainRankingInput, ctx: ToolContext) => {
    const items = load(env, input.initiatives, ctx);
    const explanations = explainRanking(items, input.method, [...new Set(input.ids)], input.compareWith);
    const lines = explanations.map(
      (e) => `#${e.rank} ${e.id} (${e.score})${e.flags.length ? ' ' + e.flags.join(',') : ''}`,
    );
    return { data: { method: input.method, explanations }, summary: lines.join('\n') };
  };
}
