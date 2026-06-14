/** Time helpers for the scheduler. All "local" math uses the device's local timezone. */

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

/** Epoch-ms at local midnight of the day containing `ms`. */
export function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Minutes elapsed since local midnight for `ms`. */
export function localMinutes(ms: number): number {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
}

/** Day-of-week 0=Sun..6=Sat for `ms` (local). */
export function localDow(ms: number): number {
  return new Date(ms).getDay();
}

/** Epoch-ms for `minutesFromMidnight` on the local day containing `dayMs`. */
export function atLocalMinutes(dayMs: number, minutesFromMidnight: number): number {
  return startOfLocalDay(dayMs) + minutesFromMidnight * MIN;
}

/** Two half-open intervals [aS,aE) [bS,bE) overlap. */
export function overlaps(aS: number, aE: number, bS: number, bE: number): boolean {
  return aS < bE && bS < aE;
}

/** "9:00 AM" style label for an epoch-ms. */
export function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** "Today" / "Tomorrow" / "Mon Jun 16" day label. */
export function fmtDay(ms: number): string {
  const today = startOfLocalDay(Date.now());
  const d = startOfLocalDay(ms);
  if (d === today) return 'Today';
  if (d === today + DAY) return 'Tomorrow';
  return new Date(ms).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Parse "HH:MM" (24h) → minutes from midnight, or null. */
export function parseHM(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]); const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}
