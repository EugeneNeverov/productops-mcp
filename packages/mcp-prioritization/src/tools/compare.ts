import * as z from 'zod/v4';
import {
  compareRankings,
  InitiativesSource,
  Meta,
  ToolFailure,
  type ToolContext,
} from '@productops-mcp/core';
import { CustomInput, load, type ToolEnv } from './common.js';

export const CompareInput = z.object({
  initiatives: InitiativesSource,
  methods: z
    .array(z.enum(['RICE', 'WSJF', 'CUSTOM']))
    .min(2)
    .max(3)
    .default(['RICE', 'WSJF']),
  custom: CustomInput.optional(),
  topN: z.number().int().min(1).max(50).default(10),
});
export type CompareInput = z.infer<typeof CompareInput>;

const RankingEntry = z.object({ id: z.string(), rank: z.number().int(), score: z.number() });

export const CompareOutput = z.object({
  rankings: z.record(z.string(), z.array(RankingEntry)),
  agreement: z.object({
    kendallTau: z.number().describe('Mean pairwise Kendall tau: 1 identical order, 0 unrelated, −1 reversed'),
    topNOverlap: z.number().describe('Mean share of top-N shared between methods'),
    pairs: z.array(
      z.object({ a: z.string(), b: z.string(), kendallTau: z.number(), topNOverlap: z.number() }),
    ),
  }),
  disagreements: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      ranks: z.record(z.string(), z.number().int()),
      drivers: z.array(z.string()),
    }),
  ),
  consensusTop: z.array(z.string()),
  excluded: z.array(z.string()),
  meta: Meta,
});

export const compareDescription =
  'Rank the same initiatives with 2–3 methods (RICE, WSJF, CUSTOM weights) and report how much they agree ' +
  '(Kendall tau, top-N overlap), which items they disagree on and why (HIGH_/LOW_ component drivers).';

export function createCompareHandler(env: ToolEnv) {
  return async (input: CompareInput, ctx: ToolContext) => {
    const methods = [...new Set(input.methods)];
    if (methods.length < 2) throw new ToolFailure('VALIDATION_ERROR', 'Pick at least two different methods.');
    if (methods.includes('CUSTOM') && !input.custom) {
      throw new ToolFailure('VALIDATION_ERROR', 'Method CUSTOM requires the "custom" weights object.');
    }
    const items = load(env, input.initiatives, ctx);
    const result = compareRankings(items, methods, input.topN, input.custom);
    if (result.excluded.length > 0) {
      ctx.warn({
        code: 'EXCLUDED_INCOMPLETE',
        message: `${result.excluded.length} item(s) lack fields for some method and were left out of the comparison.`,
        itemIds: result.excluded,
      });
    }
    const pair = result.agreement.pairs.map(
      (p) => `${p.a} vs ${p.b}: tau ${p.kendallTau}, top-${input.topN} overlap ${p.topNOverlap}`,
    );
    return {
      data: { ...result },
      summary: `${pair.join('; ')}. ${result.disagreements.length} strong disagreement(s). Consensus top: ${result.consensusTop.join(', ') || 'none'}.`,
    };
  };
}
