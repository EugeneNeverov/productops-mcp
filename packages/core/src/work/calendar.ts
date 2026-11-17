const DAY_MS = 86_400_000;

/**
 * Working days between two instants, counting Monday–Friday time in UTC as a fraction of a day.
 * Weekend time does not count. Returns 0 when `to` is not after `from`. Holidays are not modelled.
 */
export function businessDaysBetween(from: Date | string, to: Date | string): number {
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (!(b > a)) return 0;
  let total = 0;
  let cursor = a;
  while (cursor < b) {
    const dayStart = Math.floor(cursor / DAY_MS) * DAY_MS;
    const next = Math.min(dayStart + DAY_MS, b);
    const weekday = new Date(dayStart).getUTCDay();
    if (weekday !== 0 && weekday !== 6) total += next - cursor;
    cursor = next;
  }
  return total / DAY_MS;
}
