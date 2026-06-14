/**
 * Scores a candidate slot for personalization fit and produces human-readable reasons.
 * Higher = better. Used to rank the conflict-free slots the scheduler found.
 */
import type { AvailabilityProfile, SchedTaskMeta } from './types';
import { isInPeakWindow } from './freeBusy';
import { HOUR, fmtDay, fmtTime, localMinutes } from './time';

export interface ScoreResult {
  score: number;
  reasons: string[];
}

export function scoreSlot(
  meta: SchedTaskMeta,
  startMs: number,
  endMs: number,
  av: AvailabilityProfile,
  now: number,
): ScoreResult {
  let score = 100;
  const reasons: string[] = [];

  // 1) Energy match — the biggest lever for deep work.
  const peak = isInPeakWindow(av, startMs, endMs);
  if (meta.energy === 'deep') {
    if (peak) { score += 40; reasons.push('your peak focus window'); }
    else { score -= 25; }
  } else if (meta.energy === 'shallow') {
    // Shallow work is fine off-peak; gently prefer NOT burning a peak window on it.
    if (peak) score -= 8;
    const lm = localMinutes(startMs);
    if (lm >= av.workStartMin + 240) { score += 6; reasons.push('good for lighter work'); }
  }

  // 2) Deadline safety — comfortably before due, but not needlessly far out.
  if (meta.deadline) {
    const due = Date.parse(meta.deadline);
    if (Number.isFinite(due)) {
      const hoursBefore = (due - endMs) / HOUR;
      if (hoursBefore < 0) score -= 1000; // past deadline — should have been filtered, hard reject
      else if (hoursBefore < 4) { score += 18; reasons.push('beats your deadline'); }
      else if (hoursBefore < 24) { score += 10; reasons.push('comfortably before the deadline'); }
    }
  }

  // 3) Sooner is mildly better (don't let things drift) — small decay per day out.
  const daysOut = Math.floor((startMs - now) / (24 * HOUR));
  score -= daysOut * 4;
  if (daysOut === 0) reasons.push('today');

  // 4) Earlier in the working day slightly preferred for momentum.
  score -= Math.max(0, (localMinutes(startMs) - av.workStartMin)) / 120;

  if (reasons.length === 0) reasons.push(`${fmtDay(startMs)} ${fmtTime(startMs)} is open`);
  return { score: Math.round(score), reasons };
}

/** One-sentence rationale for the top suggestion. */
export function rationale(meta: SchedTaskMeta, startMs: number, endMs: number, reasons: string[]): string {
  const when = `${fmtDay(startMs)} ${fmtTime(startMs)}–${fmtTime(endMs)}`;
  const why = reasons.slice(0, 2).join(', ');
  return why ? `${when} — ${why}.` : `${when}.`;
}
