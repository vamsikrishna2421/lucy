/**
 * One place to parse stored timestamps. PURE, no native imports, unit-tested.
 *
 * SQLite's CURRENT_TIMESTAMP gives 'YYYY-MM-DD HH:MM:SS' in UTC with NO timezone marker. `new Date()`
 * on that string parses it as LOCAL time, which silently shifts every stored time by the device's UTC
 * offset (an "off-by-timezone" bug). This helper treats a zone-less SQLite string as UTC (appends 'Z')
 * and leaves already-ISO strings untouched — so every caller gets the same correct Date.
 */
export function parseDbDate(value: string | null | undefined): Date {
  const s = String(value ?? '').trim();
  if (!s) return new Date(NaN);
  // Already ISO (has a 'T', and usually its own zone) → trust it. Otherwise it's a SQLite UTC stamp.
  return new Date(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);
}

/** Milliseconds since epoch for a stored timestamp (NaN-safe via parseDbDate). */
export function dbDateMs(value: string | null | undefined): number {
  return parseDbDate(value).getTime();
}

/** Whole days between a stored timestamp and now (positive = in the past). NaN-safe → 0. */
export function daysSinceDb(value: string | null | undefined, now = Date.now()): number {
  const ms = dbDateMs(value);
  if (Number.isNaN(ms)) return 0;
  return Math.floor((now - ms) / 86400000);
}
