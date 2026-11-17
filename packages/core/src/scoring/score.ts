import { ToolFailure } from '../schemas/errors.js';
import type { Initiative } from './model.js';
import { median, round } from './stats.js';

export type ScoringMethod = 'RICE' | 'WSJF' | 'CUSTOM';

export interface CustomWeights {
  weights: Record<string, number>;
  /** Fields where a lower value is better (inverted after normalization). */
  invert: string[];
}

export interface RawScore {
  item: Initiative;
  /** null when the item lacks the fields the method needs. */
  score: number | null;
  components: Record<string, number>;
  missing: string[];
  /** Used as the second tie-break key: lower first. */
  size: number;
}

export interface RankedScore extends RawScore {
  rank: number | null;
}

const RICE_FIELDS = ['reach', 'impact', 'confidence', 'effort'] as const;
const WSJF_FIELDS = ['businessValue', 'timeCriticality', 'riskReductionOpportunity', 'jobSize'] as const;
export const NUMERIC_FIELDS = [...RICE_FIELDS, ...WSJF_FIELDS] as const;
export type NumericField = (typeof NUMERIC_FIELDS)[number];

function missingFields(item: Initiative, fields: readonly string[]): string[] {
  return fields.filter((f) => (item as Record<string, unknown>)[f] === undefined);
}

export function riceScore(item: Initiative): RawScore {
  const missing = missingFields(item, RICE_FIELDS);
  if (missing.length > 0) return { item, score: null, components: {}, missing, size: Infinity };
  const { reach, impact, confidence, effort } = item as Required<
    Pick<Initiative, (typeof RICE_FIELDS)[number]>
  >;
  return {
    item,
    score: (reach * impact * confidence) / effort,
    components: { reach, impact, confidence, effort },
    missing,
    size: effort,
  };
}

export function wsjfScore(item: Initiative): RawScore {
  const missing = missingFields(item, WSJF_FIELDS);
  if (missing.length > 0) return { item, score: null, components: {}, missing, size: Infinity };
  const { businessValue, timeCriticality, riskReductionOpportunity, jobSize } = item as Required<
    Pick<Initiative, (typeof WSJF_FIELDS)[number]>
  >;
  const costOfDelay = businessValue + timeCriticality + riskReductionOpportunity;
  return {
    item,
    score: costOfDelay / jobSize,
    components: { businessValue, timeCriticality, riskReductionOpportunity, costOfDelay, jobSize },
    missing,
    size: jobSize,
  };
}

/**
 * Weighted sum of min-max normalized fields. Each field is scaled to [0, 1] across the set
 * (0.5 when all values are equal); fields in `invert` use 1 − normalized.
 */
export function customScores(items: readonly Initiative[], custom: CustomWeights): RawScore[] {
  const fields = Object.keys(custom.weights).sort();
  const bad = fields.filter((f) => !(NUMERIC_FIELDS as readonly string[]).includes(f));
  if (bad.length > 0) {
    throw new ToolFailure('VALIDATION_ERROR', `Unknown fields in custom.weights: ${bad.join(', ')}`, {
      details: { allowed: NUMERIC_FIELDS },
    });
  }
  const ranges = new Map<string, { min: number; max: number }>();
  for (const f of fields) {
    const vals = items
      .map((i) => (i as Record<string, unknown>)[f])
      .filter((v): v is number => typeof v === 'number');
    ranges.set(f, { min: Math.min(...vals), max: Math.max(...vals) });
  }
  const effortField = fields.includes('effort')
    ? 'effort'
    : fields.includes('jobSize')
      ? 'jobSize'
      : undefined;
  return items.map((item) => {
    const missing = missingFields(item, fields);
    if (missing.length > 0) return { item, score: null, components: {}, missing, size: Infinity };
    const components: Record<string, number> = {};
    let score = 0;
    for (const f of fields) {
      const v = (item as unknown as Record<string, number>)[f]!;
      const { min, max } = ranges.get(f)!;
      let n = max === min ? 0.5 : (v - min) / (max - min);
      if (custom.invert.includes(f)) n = 1 - n;
      components[f] = n;
      score += custom.weights[f]! * n;
    }
    const size = effortField ? (item as unknown as Record<string, number>)[effortField]! : 0;
    return { item, score, components, missing, size };
  });
}

export function scoreAll(
  method: ScoringMethod,
  items: readonly Initiative[],
  custom?: CustomWeights,
): RawScore[] {
  if (method === 'RICE') return items.map(riceScore);
  if (method === 'WSJF') return items.map(wsjfScore);
  if (!custom)
    throw new ToolFailure('VALIDATION_ERROR', 'Method CUSTOM requires the "custom" weights object.');
  return customScores(items, custom);
}

/** Deterministic order: score desc → size asc → id asc. */
export function compareScores(a: RawScore, b: RawScore): number {
  return (
    (b.score ?? -Infinity) - (a.score ?? -Infinity) ||
    a.size - b.size ||
    (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0)
  );
}

/** Ranks scored items 1..n; unscored items keep input order after them with rank null. */
export function rank(scores: readonly RawScore[]): RankedScore[] {
  const scored = scores.filter((s) => s.score !== null).sort(compareScores);
  const unscored = scores.filter((s) => s.score === null);
  return [...scored.map((s, i) => ({ ...s, rank: i + 1 })), ...unscored.map((s) => ({ ...s, rank: null }))];
}

/** Throws VALIDATION_ERROR listing every missing field when `strict` and anything is unscored. */
export function assertComplete(scores: readonly RawScore[], method: string): void {
  const incomplete = scores.filter((s) => s.score === null);
  if (incomplete.length === 0) return;
  throw new ToolFailure(
    'VALIDATION_ERROR',
    `${incomplete.length} initiative(s) lack fields required by ${method}.`,
    {
      hint: 'Fill the fields, or pass options.strict = false to exclude these items with a warning.',
      details: { issues: incomplete.map((s) => ({ id: s.item.id, missing: s.missing })) },
    },
  );
}

export interface ScoredItemOut {
  [key: string]: unknown;
  id: string;
  title: string;
  score: number | null;
  rank: number | null;
  components: Record<string, number>;
  excluded: boolean;
  excludedReason?: string;
}

export function toScoredItemOut(s: RankedScore): ScoredItemOut {
  const components: Record<string, number> = {};
  for (const [k, v] of Object.entries(s.components)) components[k] = round(v);
  return {
    id: s.item.id,
    title: s.item.title,
    score: s.score === null ? null : round(s.score),
    rank: s.rank,
    components,
    excluded: s.score === null,
    ...(s.score === null ? { excludedReason: `missing: ${s.missing.join(', ')}` } : {}),
  };
}

export function scoreSummary(ranked: readonly RankedScore[]) {
  const scores = ranked.filter((r) => r.score !== null).map((r) => r.score!);
  return {
    count: ranked.length,
    excludedCount: ranked.length - scores.length,
    scoreMin: scores.length ? round(Math.min(...scores)) : null,
    scoreMedian: scores.length ? round(median(scores)) : null,
    scoreMax: scores.length ? round(Math.max(...scores)) : null,
  };
}
