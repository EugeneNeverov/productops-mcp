import * as z from 'zod/v4';
import {
  assertComplete,
  InitiativesSource,
  Meta,
  rank,
  scoreSummary,
  toScoredItemOut,
  wsjfScore,
  type Initiative,
  type ToolContext,
} from '@productops/core';
import { load, ScoredItem, ScoreSummary, topList, type ToolEnv } from './common.js';

export const CalculateWsjfInput = z.object({
  initiatives: InitiativesSource,
  options: z
    .object({
      strict: z.boolean().default(true),
      normalize: z
        .boolean()
        .default(false)
        .describe('Rescale each component so its smallest value in the set is 1 (SAFe relative estimation)'),
    })
    .default({ strict: true, normalize: false }),
});
export type CalculateWsjfInput = z.infer<typeof CalculateWsjfInput>;

export const CalculateWsjfOutput = z.object({
  method: z.literal('WSJF'),
  formula: z.string(),
  normalized: z.boolean(),
  items: z.array(ScoredItem),
  summary: ScoreSummary,
  meta: Meta,
});

export const wsjfDescription =
  'Score initiatives with WSJF = (business value + time criticality + risk reduction/opportunity) / job size ' +
  '(modified Fibonacci 1–20) and rank them. Deterministic; ties break by smaller job size, then id.';

const COMPONENTS = ['businessValue', 'timeCriticality', 'riskReductionOpportunity', 'jobSize'] as const;
const SATURATION = 0.5;

export function createWsjfHandler(env: ToolEnv) {
  return async (input: CalculateWsjfInput, ctx: ToolContext) => {
    let items = load(env, input.initiatives, ctx);
    const complete = items.filter((i) => COMPONENTS.every((c) => i[c] !== undefined));

    for (const c of COMPONENTS) {
      if (complete.length < 4) break;
      const counts = new Map<number, number>();
      for (const i of complete) counts.set(i[c]!, (counts.get(i[c]!) ?? 0) + 1);
      const top = Math.max(...counts.values());
      if (top / complete.length > SATURATION) {
        ctx.warn({
          code: 'FIB_SCALE_SATURATED',
          message: `More than ${SATURATION * 100}% of items share one ${c} value; this component barely separates them.`,
        });
      }
    }

    if (input.options.normalize && complete.length > 0) {
      const mins = Object.fromEntries(COMPONENTS.map((c) => [c, Math.min(...complete.map((i) => i[c]!))]));
      items = items.map((i) => {
        const copy: Record<string, unknown> = { ...i };
        for (const c of COMPONENTS) if (i[c] !== undefined) copy[c] = i[c]! / mins[c]!;
        return copy as Initiative;
      });
    }

    const scores = items.map(wsjfScore);
    if (input.options.strict) assertComplete(scores, 'WSJF');
    const ranked = rank(scores);
    const excluded = ranked.filter((r) => r.score === null).map((r) => r.item.id);
    if (excluded.length > 0) {
      ctx.warn({
        code: 'EXCLUDED_INCOMPLETE',
        message: `${excluded.length} item(s) lack WSJF fields and were not ranked.`,
        itemIds: excluded,
      });
    }
    const out = ranked.map(toScoredItemOut);
    return {
      data: {
        method: 'WSJF' as const,
        formula: '(businessValue + timeCriticality + riskReductionOpportunity) / jobSize',
        normalized: input.options.normalize,
        items: out,
        summary: scoreSummary(ranked),
      },
      summary: `WSJF ranking of ${out.length} initiatives. Top:\n${topList(out)}`,
    };
  };
}
