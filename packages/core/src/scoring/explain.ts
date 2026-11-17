import { ToolFailure } from '../schemas/errors.js';
import { FIB_SCALE, IMPACT_SCALE, type Initiative, type Method } from './model.js';
import { median, quantile, round } from './stats.js';
import { assertComplete, compareScores, rank, scoreAll, type RankedScore } from './score.js';

export type ExplainFlag =
  'LOW_CONFIDENCE' | 'HIGH_EFFORT_OUTLIER' | 'SINGLE_COMPONENT_DOMINATES' | 'NEAR_TIE';

export interface Contribution {
  component: string;
  value: number;
  /** ln(value / median of the set); sign flipped for "lower is better" components. */
  vsMedian: number;
  /** |vsMedian| / Σ|vsMedian| over the item's components (0 when all are at the median). */
  logShare: number;
}

export interface SensitivityEntry {
  component: string;
  toOvertake: { targetId: string; requiredValue: number; changePct: number } | null;
  toBeOvertaken: { byId: string; thresholdValue: number; changePct: number } | null;
}

export interface Explanation {
  id: string;
  rank: number;
  score: number;
  contributions: Contribution[];
  costOfDelayBreakdown?: Record<string, number>;
  sensitivity: SensitivityEntry[];
  flags: ExplainFlag[];
}

type Compare = 'neighbors' | 'top1' | 'none';

const DIGITS = 4;

interface ComponentSpec {
  name: keyof Initiative & string;
  /** true when increasing the value increases the score */
  positive: boolean;
  scale?: readonly number[];
  min?: number;
  max?: number;
}

const RICE_COMPONENTS: ComponentSpec[] = [
  { name: 'reach', positive: true, min: 0 },
  { name: 'impact', positive: true, scale: IMPACT_SCALE },
  { name: 'confidence', positive: true, min: 0, max: 1 },
  { name: 'effort', positive: false, min: Number.MIN_VALUE },
];
const WSJF_COMPONENTS: ComponentSpec[] = [
  { name: 'businessValue', positive: true, scale: FIB_SCALE },
  { name: 'timeCriticality', positive: true, scale: FIB_SCALE },
  { name: 'riskReductionOpportunity', positive: true, scale: FIB_SCALE },
  { name: 'jobSize', positive: false, scale: FIB_SCALE },
];

/**
 * Structured explanation of why items rank where they do (docs/algorithms.md §5).
 * Sensitivity varies one component at a time and re-ranks the whole set to confirm the change.
 */
export function explainRanking(
  items: readonly Initiative[],
  method: Method,
  ids: readonly string[],
  compareWith: Compare,
): Explanation[] {
  const scores = scoreAll(method, items);
  assertComplete(scores, method);
  const ranked = rank(scores);
  const byId = new Map(ranked.map((r) => [r.item.id, r]));
  const unknown = ids.filter((id) => !byId.has(id));
  if (unknown.length > 0) throw new ToolFailure('NOT_FOUND', `Unknown initiative ids: ${unknown.join(', ')}`);

  const specs = method === 'RICE' ? RICE_COMPONENTS : WSJF_COMPONENTS;
  const medians = new Map(specs.map((s) => [s.name, median(items.map((i) => i[s.name] as number))]));
  const sizeField = method === 'RICE' ? 'effort' : 'jobSize';
  const sizes = items.map((i) => i[sizeField] as number);
  const sizeFence = quantile(sizes, 0.75) + 1.5 * (quantile(sizes, 0.75) - quantile(sizes, 0.25));

  return ids.map((id) => {
    const target = byId.get(id)!;
    const r = target.rank!;
    const score = target.score!;
    const above =
      compareWith === 'none'
        ? undefined
        : compareWith === 'top1'
          ? r > 1
            ? ranked[0]
            : undefined
          : ranked[r - 2];
    const below = compareWith === 'neighbors' ? ranked[r] : undefined;

    let contributions: Contribution[];
    let breakdown: Record<string, number> | undefined;
    if (method === 'RICE') {
      contributions = logContributions(
        specs.map((s) => ({
          name: s.name,
          value: target.item[s.name] as number,
          median: medians.get(s.name)!,
          positive: s.positive,
        })),
      );
    } else {
      const cod = target.components.costOfDelay!;
      const medCod = median(
        items.map((i) => i.businessValue! + i.timeCriticality! + i.riskReductionOpportunity!),
      );
      contributions = logContributions([
        { name: 'costOfDelay', value: cod, median: medCod, positive: true },
        { name: 'jobSize', value: target.item.jobSize!, median: medians.get('jobSize')!, positive: false },
      ]);
      breakdown = {
        businessValue: round(target.item.businessValue! / cod),
        timeCriticality: round(target.item.timeCriticality! / cod),
        riskReductionOpportunity: round(target.item.riskReductionOpportunity! / cod),
      };
    }

    const sensitivity: SensitivityEntry[] =
      compareWith === 'none'
        ? []
        : specs.map((spec) => ({
            component: spec.name,
            toOvertake: mapChange(above && findChange(method, target, above, spec, 'up'), (c) => ({
              targetId: c.otherId,
              requiredValue: c.value,
              changePct: c.changePct,
            })),
            toBeOvertaken: mapChange(below && findChange(method, target, below, spec, 'down'), (c) => ({
              byId: c.otherId,
              thresholdValue: c.value,
              changePct: c.changePct,
            })),
          }));

    const flags: ExplainFlag[] = [];
    if (method === 'RICE' && target.item.confidence! < 0.5) flags.push('LOW_CONFIDENCE');
    if ((target.item[sizeField] as number) > sizeFence) flags.push('HIGH_EFFORT_OUTLIER');
    if (contributions.some((c) => c.logShare > 0.6) && contributions.filter((c) => c.logShare > 0).length > 1)
      flags.push('SINGLE_COMPONENT_DOMINATES');
    const neighbors = [ranked[r - 2], ranked[r]].filter((n): n is RankedScore => n !== undefined);
    if (score > 0 && neighbors.some((n) => Math.abs(n.score! - score) / score < 0.05)) flags.push('NEAR_TIE');

    return {
      id,
      rank: r,
      score: round(score),
      contributions,
      ...(breakdown ? { costOfDelayBreakdown: breakdown } : {}),
      sensitivity,
      flags,
    };
  });
}

function logContributions(
  parts: { name: string; value: number; median: number; positive: boolean }[],
): Contribution[] {
  const raw = parts.map((p) => {
    let v =
      p.value > 0 && p.median > 0
        ? Math.log(p.value / p.median)
        : p.value === p.median
          ? 0
          : p.value > p.median
            ? 1
            : -1;
    if (!p.positive) v = -v;
    return { ...p, vsMedian: v };
  });
  const total = raw.reduce((s, p) => s + Math.abs(p.vsMedian), 0);
  return raw.map((p) => ({
    component: p.name,
    value: p.value,
    vsMedian: round(p.vsMedian),
    logShare: total === 0 ? 0 : round(Math.abs(p.vsMedian) / total),
  }));
}

/**
 * Smallest single-component change that makes `target` pass `other` ('up') or lets `other`
 * pass `target` ('down'), verified by re-ranking. Continuous components use the exact
 * break-even value nudged past the tie; discrete ones walk their scale.
 */
interface Change {
  otherId: string;
  value: number;
  changePct: number;
}

function mapChange<T>(c: Change | null | undefined, f: (c: Change) => T): T | null {
  return c ? f(c) : null;
}

function findChange(
  method: Method,
  target: RankedScore,
  other: RankedScore,
  spec: ComponentSpec,
  dir: 'up' | 'down',
): Change | null {
  const current = target.item[spec.name] as number;
  const beats = (value: number) => {
    const changed = { ...target.item, [spec.name]: value } as Initiative;
    const s = scoreAll(method, [changed])[0]!;
    const cmp = compareScores(s, other);
    return dir === 'up' ? cmp < 0 : cmp > 0;
  };
  // Direction in which the component must move so that the score moves the right way.
  const increase = (dir === 'up') === spec.positive;

  let found: number | undefined;
  if (spec.scale) {
    const candidates = spec.scale.filter((v) => (increase ? v > current : v < current));
    if (!increase) candidates.reverse();
    found = candidates.find(beats);
  } else {
    const even = continuousBreakEven(method, target, other, spec, current);
    if (even !== undefined) {
      // Round away from the tie to the reported precision, so the value we print is one that works.
      const f = 10 ** DIGITS;
      let v = increase ? Math.ceil(even * f) / f : Math.floor(even * f) / f;
      if (v === even) v = increase ? v + 1 / f : v - 1 / f;
      const ok = (x: number) =>
        (spec.max === undefined || x <= spec.max) && (spec.min === undefined || x >= spec.min) && beats(x);
      // One more step covers floating-point noise right at the break-even point.
      const next = Math.round((increase ? v + 1 / f : v - 1 / f) * f) / f;
      found = ok(v) ? v : ok(next) ? next : undefined;
    }
  }
  if (found === undefined) return null;
  const changePct = current === 0 ? (found === 0 ? 0 : Infinity) : ((found - current) / current) * 100;
  const value = found;
  const pct = Number.isFinite(changePct) ? round(changePct, 2) : null;
  if (pct === null) return null;
  return { otherId: other.item.id, value, changePct: pct };
}

/** Value of one RICE component at which target's score equals other's (multiplicative formula). */
function continuousBreakEven(
  method: Method,
  target: RankedScore,
  other: RankedScore,
  spec: ComponentSpec,
  current: number,
): number | undefined {
  if (method !== 'RICE') return undefined;
  const s = target.score!;
  const t = other.score!;
  if (spec.positive) {
    if (s === 0) return undefined; // a zero product cannot be scaled up
    return (current * t) / s;
  }
  if (t === 0) return undefined;
  return (current * s) / t;
}
