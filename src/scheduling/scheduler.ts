/**
 * The slot finder + conflict validator. Pure functions over supplied blocks so the foolproof
 * invariant is fully unit-testable (see tests/calendar.ts).
 *
 * - hardBlocks: sleep / out-of-hours / protected — NO overlap allowed (even by passive tasks).
 * - resourceBlocks: calendar events + committed task-blocks — overlap allowed iff canCoexist.
 */
import type { AvailabilityProfile, Block, SchedTaskMeta, SlotSuggestion, TimeWindow } from './types';
import { MIN, localMinutes, localDow, overlaps, startOfLocalDay, DAY, HOUR } from './time';
import { canCoexist } from './resources';
import { scoreSlot } from './scorer';
import { loadOf, scoreLoad, capacityAt, type BlockLoad } from './load';

const STEP_MIN = 15;

function inWindow(startMs: number, win: TimeWindow, av: AvailabilityProfile): boolean {
  if (!win) return true;
  const lm = localMinutes(startMs);
  switch (win) {
    case 'morning': return lm < 12 * 60;
    case 'afternoon': return lm >= 12 * 60 && lm < 17 * 60;
    case 'evening': return lm >= 17 * 60;
    case 'workhours': return lm >= av.workStartMin && lm < av.workEndMin;
  }
}

export interface FindSlotsInput {
  meta: SchedTaskMeta;
  hardBlocks: Block[];
  resourceBlocks: Block[];
  availability: AvailabilityProfile;
  now?: number;
  horizonDays?: number;
  maxResults?: number;
  earliestStart?: number; // don't suggest before this (defaults to now + 10min lead)
}

/** Find conflict-free, personalization-ranked slots for a task. */
export function findSlots(input: FindSlotsInput): SlotSuggestion[] {
  const { meta, hardBlocks, resourceBlocks, availability: av } = input;
  const now = input.now ?? Date.now();
  const lead = input.earliestStart ?? now + 10 * MIN;
  const durMs = Math.max(5, meta.durationMin) * MIN;
  const buffer = av.bufferMin * MIN;

  // Horizon: up to the deadline, else N days out.
  const horizonDays = input.horizonDays ?? 7;
  let to = startOfLocalDay(now) + (horizonDays + 1) * DAY;
  if (meta.deadline) {
    const due = Date.parse(meta.deadline);
    if (Number.isFinite(due)) to = Math.min(to, due);
  }

  // Allowed time-of-day window. Work hours bound WORK tasks on WORKDAYS; personal/evening/
  // explicitly-timed/passive tasks (and ANY task on a non-workday/weekend) may use the awake window.
  const nightEnd = av.sleepStartMin > av.sleepEndMin ? av.sleepStartMin : 22 * 60;
  // Personal tasks (incl. explicitly-evening/timed/passive) use the awake window; office tasks stay in
  // office hours. Domain is the explicit signal; the older heuristics remain for unclassified tasks.
  const personal = meta.domain === 'personal' || meta.earliestMin != null || meta.latestMin != null || meta.timeWindow === 'evening' || meta.energy === 'passive';
  const workDays = av.workDays && av.workDays.length ? av.workDays : [1, 2, 3, 4, 5];

  // Start search at the next STEP boundary after lead.
  let from = Math.ceil(lead / (STEP_MIN * MIN)) * (STEP_MIN * MIN);

  // Effort-load context (brain/muscle/attention): the new task's load + the loads of nearby committed
  // blocks, so each candidate can be scored for rolling sustainability (don't stack same-effort work).
  const candLoad = loadOf(meta.title, meta.resources, meta.energy);
  const blockLoads: BlockLoad[] = resourceBlocks.map((b) => ({ start: b.start, end: b.end, ...loadOf(b.title, b.resources) }));

  const candidates: SlotSuggestion[] = [];
  for (let s = from; s + durMs <= to; s += STEP_MIN * MIN) {
    const e = s + durMs;

    // Per-day window: weekends + personal tasks use the awake window; workdays bound work tasks.
    const isWorkday = workDays.includes(localDow(s));
    // Office tasks belong in office hours on workdays — never on weekends.
    if (meta.domain === 'office' && !isWorkday) continue;
    let winStart = (personal || !isWorkday) ? av.sleepEndMin : av.workStartMin;
    let winEnd = (personal || !isWorkday) ? nightEnd : av.workEndMin;
    if (meta.domain === 'office' && isWorkday) { winStart = av.workStartMin; winEnd = av.workEndMin; } // keep work in work hours
    if (meta.earliestMin != null) winStart = Math.max(winStart, meta.earliestMin);
    if (meta.latestMin != null) winEnd = Math.min(winEnd, meta.latestMin + Math.max(5, meta.durationMin));

    const lm = localMinutes(s);
    const lmEnd = localMinutes(e - 1);
    if (lm < winStart || lmEnd >= winEnd) continue;
    // Don't let personal things intercept office hours on a workday.
    if (meta.domain === 'personal' && isWorkday && lm < av.workEndMin && lmEnd >= av.workStartMin) continue;
    if (startOfLocalDay(s) !== startOfLocalDay(e - 1)) continue; // no midnight spanning
    if (!inWindow(s, meta.timeWindow ?? null, av)) continue;
    if (meta.latestMin != null && lm > meta.latestMin) continue; // start must be before the ceiling

    // Hard blocks: never overlap.
    if (hardBlocks.some((b) => overlaps(s, e, b.start, b.end))) continue;

    // Resource blocks: must coexist; keep a buffer from any block we can't run alongside.
    let ok = true;
    for (const b of resourceBlocks) {
      if (!overlaps(s - buffer, e + buffer, b.start, b.end)) continue;
      if (!canCoexist(meta.resources, b.resources)) { ok = false; break; }
    }
    if (!ok) continue;

    const { score, reasons } = scoreSlot(meta, s, e, av, now);
    // Effort sustainability: penalize slots that would over-concentrate brain/muscle/attention in any
    // rolling 3h window (interleave instead of stacking); small reward when a demanding task fits well.
    // The capacity threshold is TIME-LOCAL — higher in the peak, lower in the dip, zero in sleep.
    const load = scoreLoad(candLoad, s, e, blockLoads, capacityAt(av, s + (e - s) / 2));
    candidates.push({ start: s, end: e, score: score + load.delta, reasons: [...reasons, ...load.reasons] });
  }

  // Rank, then thin out near-duplicates (keep best; drop others within 90 min on the same day).
  candidates.sort((a, b) => b.score - a.score);
  const picked: SlotSuggestion[] = [];
  for (const c of candidates) {
    if (picked.some((p) => Math.abs(p.start - c.start) < 90 * MIN)) continue;
    picked.push(c);
    if (picked.length >= (input.maxResults ?? 3)) break;
  }
  return picked;
}

export interface PlanConflict {
  a: Block;
  b: Block;
  reason: string;
}

/** Scans committed blocks (+ calendar) for any overlapping pair that cannot coexist. */
export function validatePlan(blocks: Block[]): PlanConflict[] {
  const conflicts: PlanConflict[] = [];
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const a = blocks[i]; const b = blocks[j];
      if (!overlaps(a.start, a.end, b.start, b.end)) continue;
      if (!canCoexist(a.resources, b.resources)) {
        conflicts.push({ a, b, reason: 'These overlap and cannot run in parallel.' });
      }
    }
  }
  return conflicts;
}

export { HOUR };
