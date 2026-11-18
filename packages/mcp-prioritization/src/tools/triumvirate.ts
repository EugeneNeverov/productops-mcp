import * as z from 'zod/v4';
import {
  aggregateTriumvirate,
  buildBrief,
  InitiativesSource,
  JudgeRole,
  JudgeVerdict,
  Meta,
  ToolFailure,
  TriumvirateWeights,
  type ToolContext,
} from '@productops-mcp/core';
import { load, type ToolEnv } from './common.js';

/** Briefs carry every item into three agent contexts, so they are capped well below MAX_INITIATIVES. */
export const MAX_BRIEF_ITEMS = 60;

// ---------- triumvirate_brief ----------

export const TriumvirateBriefInput = z.object({
  initiatives: InitiativesSource,
  ids: z
    .array(z.string())
    .min(1)
    .max(MAX_BRIEF_ITEMS)
    .optional()
    .describe(`Only these initiatives (default: all, at most ${MAX_BRIEF_ITEMS})`),
  context: z
    .string()
    .max(2000)
    .optional()
    .describe("Strategy, goals or constraints every judge should know, in the user's language"),
});
export type TriumvirateBriefInput = z.infer<typeof TriumvirateBriefInput>;

const CriterionOut = z.object({
  key: z.string(),
  question: z.string(),
  higherIsBetter: z.boolean(),
  low: z.string(),
  high: z.string(),
});

export const TriumvirateBriefOutput = z.object({
  judges: z.array(
    z.object({
      role: JudgeRole,
      title: z.string(),
      criteria: z.array(CriterionOut),
      instructions: z.string().describe("The full task for this judge's agent; pass it on unchanged"),
    }),
  ),
  items: z.array(z.record(z.string(), z.unknown())),
  protocol: z.array(z.string()),
  meta: Meta,
});

export const triumvirateBriefDescription =
  'Optional alternative to RICE/WSJF. Step 1 of the triumvirate: writes one brief for each of three independent ' +
  'judges (dev, business/marketing, product). Run each brief as a SEPARATE agent that does not see the other ' +
  "judges' answers, then pass the three JSON answers to triumvirate_verdict. Use only when the user asks for " +
  'independent judges or a triumvirate.';

export function createTriumvirateBriefHandler(env: ToolEnv) {
  return async (input: TriumvirateBriefInput, ctx: ToolContext) => {
    let items = load(env, input.initiatives, ctx);
    if (input.ids) {
      const known = new Set(items.map((i) => i.id));
      const unknown = input.ids.filter((id) => !known.has(id));
      if (unknown.length > 0) {
        throw new ToolFailure('NOT_FOUND', `Unknown initiative id(s): ${unknown.join(', ')}`, {
          details: { ids: unknown },
        });
      }
      const wanted = new Set(input.ids);
      items = items.filter((i) => wanted.has(i.id));
    }
    if (items.length > MAX_BRIEF_ITEMS) {
      throw new ToolFailure(
        'INPUT_TOO_LARGE',
        `${items.length} initiatives is too many for one round of judges (max ${MAX_BRIEF_ITEMS}).`,
        { hint: 'Pass "ids" with a shortlist, for example the top of calculate_rice, or split the backlog.' },
      );
    }
    const brief = buildBrief(items, input.context);
    return {
      data: { ...brief, items: brief.items as Record<string, unknown>[] },
      summary:
        `Briefs for 3 judges (dev, business, product) on ${items.length} initiative(s). ` +
        'Run each judge as a separate agent with only its "instructions", then call triumvirate_verdict with the three answers.',
    };
  };
}

// ---------- triumvirate_verdict ----------

export const TriumvirateVerdictInput = z.object({
  initiatives: InitiativesSource.describe('The same source that was passed to triumvirate_brief'),
  verdicts: z
    .object({ dev: JudgeVerdict, business: JudgeVerdict, product: JudgeVerdict })
    .describe("Each judge's JSON answer, unchanged"),
  weights: TriumvirateWeights.default({ dev: 1, business: 1, product: 1 }).describe(
    'Weight of each judge in the agreed score; 0 makes a judge advisory only',
  ),
  splitThreshold: z
    .number()
    .min(1)
    .max(101)
    .default(40)
    .describe(
      'Max − min of judge scores (0..100) at which an item goes to needsDecision instead of the ranking',
    ),
});
export type TriumvirateVerdictInput = z.infer<typeof TriumvirateVerdictInput>;

const Scores = z.object({ dev: z.number(), business: z.number(), product: z.number() }).partial();
const Pull = z.object({ criterion: z.string(), value: z.number(), direction: z.enum(['for', 'against']) });

export const TriumvirateVerdictOutput = z.object({
  ranking: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      rank: z.number().int(),
      score: z.number().describe('Weighted mean of judge scores, 0..100'),
      spread: z.number(),
      scores: Scores,
      lowConfidence: z.boolean(),
    }),
  ),
  needsDecision: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      spread: z.number(),
      scores: Scores,
      highest: JudgeRole,
      lowest: JudgeRole,
      opinions: z.array(
        z.object({
          judge: JudgeRole,
          score: z.number(),
          confidence: z.number(),
          rationale: z.string(),
          pulls: z.array(Pull),
        }),
      ),
    }),
  ),
  insufficient: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      scoredBy: z.array(JudgeRole),
      reasons: z.record(z.string(), z.string()),
    }),
  ),
  agreement: z.object({
    kendallTau: z.number().nullable().describe('Mean pairwise Kendall tau between judges'),
    pairs: z.array(
      z.object({
        a: JudgeRole,
        b: JudgeRole,
        kendallTau: z.number().nullable(),
        meanAbsDiff: z.number().nullable(),
        items: z.number().int(),
      }),
    ),
  }),
  judges: z.record(
    z.string(),
    z.object({
      model: z.string().optional(),
      scored: z.number().int(),
      abstained: z.number().int(),
      missing: z.array(z.string()),
    }),
  ),
  meta: Meta,
});

export const triumvirateVerdictDescription =
  "Step 2 of the triumvirate: merges the three independent judges' answers from triumvirate_brief. Items the " +
  'judges agree on are ranked by the weighted mean score; items where they disagree strongly are NOT averaged ' +
  "but listed in needsDecision with each judge's score, rationale and criteria, for the user to decide.";

export function createTriumvirateVerdictHandler(env: ToolEnv) {
  return async (input: TriumvirateVerdictInput, ctx: ToolContext) => {
    const items = load(env, input.initiatives, ctx);
    const result = aggregateTriumvirate(items, input.verdicts, {
      weights: input.weights,
      splitThreshold: input.splitThreshold,
    });
    const judged = new Set(Object.values(input.verdicts).flatMap((v) => v.items.map((i) => i.id)));
    const notJudged = items.filter((i) => !judged.has(i.id)).map((i) => i.id);
    const partly = result.insufficient.map((i) => i.id).filter((id) => !notJudged.includes(id));
    if (partly.length > 0) {
      ctx.warn({
        code: 'INSUFFICIENT_JUDGES',
        message: `${partly.length} item(s) were scored by fewer than two judges and are not ranked.`,
        itemIds: partly,
      });
    }
    const low = result.ranking.filter((r) => r.lowConfidence).map((r) => r.id);
    if (low.length > 0) {
      ctx.warn({
        code: 'LOW_CONFIDENCE',
        message: `Judges were unsure about ${low.length} ranked item(s).`,
        itemIds: low,
      });
    }
    const top = result.ranking
      .slice(0, 5)
      .map((r) => `${r.rank}. ${r.title} (${r.id}) — ${r.score}`)
      .join('\n');
    const split = result.needsDecision.map(
      (s) => `${s.id} (${s.highest} ${s.scores[s.highest]} vs ${s.lowest} ${s.scores[s.lowest]})`,
    );
    // Items left out of every verdict (e.g. the brief used "ids") are simply not part of this round.
    const insufficient = result.insufficient.filter((i) => !notJudged.includes(i.id));
    return {
      data: { ...result, insufficient },
      summary:
        `${result.ranking.length} agreed, ${result.needsDecision.length} need your decision, ${insufficient.length} not enough judges. ` +
        `Judge agreement tau ${result.agreement.kendallTau ?? 'n/a'}.\n${top}` +
        (split.length > 0 ? `\nNeeds decision: ${split.join('; ')}` : ''),
    };
  };
}
