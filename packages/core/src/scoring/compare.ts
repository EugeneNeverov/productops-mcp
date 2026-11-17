import type { Initiative } from './model.js';
import { quantile, kendallTau, round } from './stats.js';
import {
  NUMERIC_FIELDS,
  rank,
  scoreAll,
  type CustomWeights,
  type RankedScore,
  type ScoringMethod,
} from './score.js';

export interface CompareResult {
  rankings: Record<string, { id: string; rank: number; score: number }[]>;
  agreement: {
    kendallTau: number;
    topNOverlap: number;
    pairs: { a: string; b: string; kendallTau: number; topNOverlap: number }[];
  };
  disagreements: { id: string; title: string; ranks: Record<string, number>; drivers: string[] }[];
  consensusTop: string[];
  /** ids that could not be ranked by at least one method; they are left out of the comparison. */
  excluded: string[];
}

/**
 * Ranks the set with each method over the items every method can score, then reports
 * pairwise Kendall tau, top-N overlap and the items whose ranks differ the most.
 */
export function compareRankings(
  items: readonly Initiative[],
  methods: readonly ScoringMethod[],
  topN: number,
  custom?: CustomWeights,
): CompareResult {
  const scorable = new Set(items.map((i) => i.id));
  const perMethod = new Map<string, RankedScore[]>();
  for (const m of methods) {
    for (const s of scoreAll(m, items, custom)) if (s.score === null) scorable.delete(s.item.id);
  }
  const common = items.filter((i) => scorable.has(i.id));
  for (const m of methods) perMethod.set(m, rank(scoreAll(m, common, custom)));

  const rankMaps = new Map<string, Map<string, number>>();
  const rankings: CompareResult['rankings'] = {};
  for (const [m, ranked] of perMethod) {
    rankMaps.set(m, new Map(ranked.map((r) => [r.item.id, r.rank!])));
    rankings[m] = ranked.map((r) => ({ id: r.item.id, rank: r.rank!, score: round(r.score!) }));
  }

  const n = Math.min(topN, common.length);
  const topSets = new Map([...perMethod].map(([m, r]) => [m, new Set(r.slice(0, n).map((x) => x.item.id))]));
  const pairs: CompareResult['agreement']['pairs'] = [];
  for (let i = 0; i < methods.length; i++) {
    for (let j = i + 1; j < methods.length; j++) {
      const a = methods[i]!;
      const b = methods[j]!;
      const overlap = n === 0 ? 1 : [...topSets.get(a)!].filter((id) => topSets.get(b)!.has(id)).length / n;
      pairs.push({
        a,
        b,
        kendallTau: round(kendallTau(rankMaps.get(a)!, rankMaps.get(b)!)),
        topNOverlap: round(overlap),
      });
    }
  }
  const mean = (xs: number[]) => (xs.length ? round(xs.reduce((s, x) => s + x, 0) / xs.length) : 1);

  const threshold = Math.max(3, Math.ceil(0.2 * common.length));
  const drivers = componentDrivers(common);
  const disagreements = common
    .map((item) => {
      const ranks: Record<string, number> = {};
      for (const m of methods) ranks[m] = rankMaps.get(m)!.get(item.id)!;
      const values = Object.values(ranks);
      return { item, ranks, spread: Math.max(...values) - Math.min(...values) };
    })
    .filter((d) => d.spread >= threshold)
    .sort((a, b) => b.spread - a.spread || (a.item.id < b.item.id ? -1 : 1))
    .map((d) => ({
      id: d.item.id,
      title: d.item.title,
      ranks: d.ranks,
      drivers: drivers.get(d.item.id) ?? [],
    }));

  const consensusTop = (perMethod.get(methods[0]!) ?? [])
    .slice(0, n)
    .map((r) => r.item.id)
    .filter((id) => [...topSets.values()].every((s) => s.has(id)));

  return {
    rankings,
    agreement: {
      kendallTau: mean(pairs.map((p) => p.kendallTau)),
      topNOverlap: mean(pairs.map((p) => p.topNOverlap)),
      pairs,
    },
    disagreements,
    consensusTop,
    excluded: items.filter((i) => !scorable.has(i.id)).map((i) => i.id),
  };
}

/**
 * Machine-readable codes for components where an item is extreme within the set:
 * HIGH_<FIELD> at or above the 80th percentile and above the median, LOW_<FIELD> at or below the
 * 20th percentile and below the median.
 */
export function componentDrivers(items: readonly Initiative[]): Map<string, string[]> {
  const out = new Map<string, string[]>(items.map((i) => [i.id, []]));
  for (const field of NUMERIC_FIELDS) {
    const vals = items.map((i) => i[field]).filter((v): v is number => typeof v === 'number');
    if (vals.length < 3) continue;
    const lo = quantile(vals, 0.2);
    const hi = quantile(vals, 0.8);
    const mid = quantile(vals, 0.5);
    const code = field.replace(/([A-Z])/g, '_$1').toUpperCase();
    for (const item of items) {
      const v = item[field];
      if (typeof v !== 'number') continue;
      // Strictly away from the median, so a field where most items share one value marks only the outliers.
      if (v >= hi && v > mid) out.get(item.id)!.push(`HIGH_${code}`);
      else if (v <= lo && v < mid) out.get(item.id)!.push(`LOW_${code}`);
    }
  }
  return out;
}
