/**
 * Money goals / savings runway (Vamsi top-6 #2) — PURE math + guidance. Turns "save 2000 for the move
 * by Aug" into a number: how much is saved, the pace, and whether that pace lands the target by the
 * deadline. No DB here (db/moneyGoals.ts persists; this computes + phrases). Copy is warm + human.
 */

export interface GoalContribution { amount: number; created_at: string }

export interface GoalProgress {
  saved: number;
  target: number;
  remaining: number;             // max(target − saved, 0)
  pct: number;                   // saved / target (0..1+, clamp for display)
  done: boolean;
  daysLeft: number | null;       // null when no deadline; negative if past
  perWeekPace: number;           // current weekly pace (saved / weeks since start)
  perWeekNeeded: number | null;  // weekly amount needed from now to hit target by the deadline
  projectedTotal: number | null; // pace projected across the whole window (null when no deadline)
  onTrack: boolean | null;       // projectedTotal >= target (null when no deadline)
}

const DAY = 86_400_000;
const WEEK = 7 * DAY;

export function computeGoalProgress(
  target: number,
  contributions: GoalContribution[],
  startISO: string,
  deadlineISO: string | null,
  now = Date.now(),
): GoalProgress {
  const saved = contributions.reduce((s, c) => s + (Number.isFinite(c.amount) ? c.amount : 0), 0);
  const tgt = target > 0 ? target : 0;
  const remaining = Math.max(tgt - saved, 0);
  const pct = tgt > 0 ? saved / tgt : 0;
  const done = tgt > 0 && saved >= tgt;

  const start = Date.parse(startISO);
  const elapsedMs = Number.isFinite(start) ? Math.max(now - start, DAY) : WEEK; // floor at 1 day → no wild pace
  const perWeekPace = saved / (elapsedMs / WEEK);

  let daysLeft: number | null = null;
  let perWeekNeeded: number | null = null;
  let projectedTotal: number | null = null;
  let onTrack: boolean | null = null;

  const deadline = deadlineISO ? Date.parse(deadlineISO) : NaN;
  if (Number.isFinite(deadline)) {
    daysLeft = Math.round((deadline - now) / DAY);
    const weeksLeft = Math.max((deadline - now) / WEEK, 0);
    perWeekNeeded = weeksLeft > 0 ? remaining / weeksLeft : remaining;
    const totalWeeks = Number.isFinite(start) ? Math.max((deadline - start) / WEEK, elapsedMs / WEEK) : elapsedMs / WEEK;
    projectedTotal = perWeekPace * totalWeeks;
    onTrack = done || projectedTotal >= tgt;
  }

  return { saved, target: tgt, remaining, pct, done, daysLeft, perWeekPace, perWeekNeeded, projectedTotal, onTrack };
}

export function formatMoney(n: number, currency = '₹'): string {
  return `${currency}${Math.round(n).toLocaleString()}`;
}

/** One warm, human line summarizing a goal's status. */
export function goalGuidance(label: string, p: GoalProgress, currency = '₹', now = Date.now()): string {
  const pctStr = `${Math.round(Math.min(p.pct, 1) * 100)}%`;
  const saved = formatMoney(p.saved, currency);
  const target = formatMoney(p.target, currency);

  if (p.done) return `You hit your ${label} goal — ${saved} of ${target} saved. 🎉`;
  if (p.daysLeft == null) {
    return `${label}: ${saved} of ${target} (${pctStr}). No deadline yet — you're putting away about ${formatMoney(p.perWeekPace, currency)}/week.`;
  }
  if (p.daysLeft < 0) {
    return `${label}: ${saved} of ${target} (${pctStr}). The deadline has passed and you're ${formatMoney(p.remaining, currency)} short.`;
  }
  const by = new Date(now + p.daysLeft * DAY).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const need = p.perWeekNeeded != null ? formatMoney(p.perWeekNeeded, currency) : '';
  if (p.onTrack) {
    return `On track for ${label}: ${saved} of ${target} (${pctStr}). About ${need}/week keeps you on pace for ${by}.`;
  }
  return `Behind on ${label}: ${saved} of ${target} (${pctStr}). You'd need about ${need}/week to reach ${target} by ${by} — ahead of your current ${formatMoney(p.perWeekPace, currency)}/week.`;
}
