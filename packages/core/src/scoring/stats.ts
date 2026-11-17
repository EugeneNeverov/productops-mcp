/** Small numeric helpers shared by scoring and metrics. All are pure and deterministic. */

export function round(x: number, digits = 4): number {
  const f = 10 ** digits;
  return Math.round((x + Number.EPSILON) * f) / f;
}

/** Linear-interpolated quantile (same as numpy's default), q in [0, 1]. */
export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export const median = (values: readonly number[]) => quantile(values, 0.5);

/** Kendall's tau-a between two rankings of the same ids (ranks are unique, so tau-a = tau-b). */
export function kendallTau(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): number {
  const ids = [...a.keys()].filter((id) => b.has(id)).sort();
  const n = ids.length;
  if (n < 2) return 1;
  let concordant = 0;
  let discordant = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const da = a.get(ids[i]!)! - a.get(ids[j]!)!;
      const db = b.get(ids[i]!)! - b.get(ids[j]!)!;
      const s = Math.sign(da) * Math.sign(db);
      if (s > 0) concordant++;
      else if (s < 0) discordant++;
    }
  }
  return (concordant - discordant) / ((n * (n - 1)) / 2);
}
