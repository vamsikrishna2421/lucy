/**
 * Pure time/day resolution for the voice command brain — no DB/native imports, so it's unit-testable
 * (tests/hardening.ts). Turns the LLM's spoken day + HH:MM into a concrete ms epoch.
 */
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * Resolve the spoken day + HH:MM time to a concrete ms epoch (or null if no/invalid time).
 * - 'today' / null: today (rolls forward a day if the time already passed)
 * - 'tomorrow': +1 day
 * - weekday name ("monday", "next friday"): the UPCOMING occurrence (same weekday as today → next
 *   week's, never today). Previously these silently fell through to TODAY, so "next Tuesday" booked today.
 * - 'YYYY-MM-DD': that exact date (no roll-forward).
 */
export function computeStart(day: string | null, time: string | null, now: number): number | null {
  if (!time) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return null;
  const hh = Number(m[1]); const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null; // reject invalid clock times (e.g. "25:99")
  const d = new Date(now);
  const dayL = (day ?? '').trim().toLowerCase();
  if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const p = day.split('-').map(Number); d.setFullYear(p[0], p[1] - 1, p[2]);
  } else if (dayL === 'tomorrow') {
    d.setDate(d.getDate() + 1);
  } else {
    const wd = WEEKDAYS.findIndex((w) => dayL.includes(w));
    if (wd >= 0) {
      let add = (wd - d.getDay() + 7) % 7;
      if (add === 0) add = 7; // same weekday as today → next week's, never today
      d.setDate(d.getDate() + add);
    }
  }
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  let ms = d.getTime();
  if (ms < now - 60_000 && (!dayL || dayL === 'today')) { d.setDate(d.getDate() + 1); ms = d.getTime(); }
  return ms;
}
