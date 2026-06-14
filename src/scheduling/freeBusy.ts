/**
 * Builds the "unavailable" blocks the scheduler must respect: sleep, out-of-working-hours, and
 * protected windows (meals/gym/etc). Pure + deterministic so the conflict invariant is testable.
 * Calendar events and committed scheduled-blocks are supplied by the caller (see index.ts).
 */
import type { AvailabilityProfile, Block } from './types';
import { DAY, atLocalMinutes, startOfLocalDay } from './time';
import { windowAppliesOn } from './availability';

const EXCLUSIVE: Block['resources'] = { axes: ['focus', 'self'], location: null };

/**
 * Non-working / protected blocks across [fromMs, toMs] derived from the availability profile.
 * Sleep can wrap midnight (sleepStart > sleepEnd), handled per local day.
 */
export function nonWorkingBlocks(av: AvailabilityProfile, fromMs: number, toMs: number): Block[] {
  const out: Block[] = [];
  // Iterate each local day touched by the range (pad one day each side for wrap-around sleep).
  for (let day = startOfLocalDay(fromMs) - DAY; day <= toMs; day += DAY) {
    const dow = new Date(day).getDay();

    // Sleep: [sleepStart, midnight) + [midnight, sleepEnd) when it wraps.
    if (av.sleepStartMin > av.sleepEndMin) {
      out.push(mk('Sleep', atLocalMinutes(day, av.sleepStartMin), atLocalMinutes(day, 24 * 60), 'sleep'));
      out.push(mk('Sleep', atLocalMinutes(day, 0), atLocalMinutes(day, av.sleepEndMin), 'sleep'));
    } else {
      out.push(mk('Sleep', atLocalMinutes(day, av.sleepStartMin), atLocalMinutes(day, av.sleepEndMin), 'sleep'));
    }

    // Before work-start and after work-end are off-limits for scheduling task-blocks.
    out.push(mk('Before work', atLocalMinutes(day, 0), atLocalMinutes(day, av.workStartMin), 'protected'));
    out.push(mk('After work', atLocalMinutes(day, av.workEndMin), atLocalMinutes(day, 24 * 60), 'protected'));

    // Protected windows (lunch, gym, etc).
    for (const w of av.protectedWindows) {
      if (windowAppliesOn(w, dow)) {
        out.push(mk(w.label, atLocalMinutes(day, w.startMin), atLocalMinutes(day, w.endMin), 'protected'));
      }
    }
  }
  // Clip to range.
  return out
    .map((b) => ({ ...b, start: Math.max(b.start, fromMs), end: Math.min(b.end, toMs) }))
    .filter((b) => b.end > b.start);
}

function mk(title: string, start: number, end: number, source: Block['source']): Block {
  return { title, start, end, resources: EXCLUSIVE, source };
}

/** Whether a candidate span sits inside a peak-energy window on its day. */
export function isInPeakWindow(av: AvailabilityProfile, startMs: number, endMs: number): boolean {
  const dayStart = startOfLocalDay(startMs);
  const dow = new Date(startMs).getDay();
  return av.peakWindows.some((w) => {
    if (!windowAppliesOn(w, dow)) return false;
    const ws = dayStart + w.startMin * 60_000;
    const we = dayStart + w.endMin * 60_000;
    return startMs >= ws && endMs <= we;
  });
}
