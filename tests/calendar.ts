/**
 * Calendar engine tests — prove the foolproof invariant with pure logic (no DB/calendar).
 * Run: npx tsx tests/calendar.ts
 */
import { canCoexist, normalizeResources } from '../src/scheduling/resources';
import { classifyTask } from '../src/scheduling/classify';
import { findSlots, validatePlan } from '../src/scheduling/scheduler';
import { nonWorkingBlocks } from '../src/scheduling/freeBusy';
import type { AvailabilityProfile, Block, SchedTaskMeta, TaskResources } from '../src/scheduling/types';
import { startOfLocalDay, MIN, overlaps } from '../src/scheduling/time';

let pass = 0; let fail = 0;
function ok(name: string, cond: boolean) { if (cond) { pass++; } else { fail++; console.error('  ✗ FAIL:', name); } }

const AV: AvailabilityProfile = {
  workStartMin: 9 * 60, workEndMin: 18 * 60, sleepStartMin: 23 * 60 + 30, sleepEndMin: 7 * 60 + 30,
  bufferMin: 10, maxFocusMinPerDay: 240, workDays: [1, 2, 3, 4, 5],
  protectedWindows: [{ label: 'Lunch', startMin: 12 * 60 + 30, endMin: 13 * 60 + 30 }],
  peakWindows: [{ label: 'AM', startMin: 9 * 60, endMin: 11 * 60 + 30 }],
  inferred: true, confirmedAt: null,
};

// ── canCoexist ────────────────────────────────────────────────────────────────
const focus: TaskResources = { axes: ['focus'], location: null };
const passive: TaskResources = { axes: [], location: null };
const callR: TaskResources = { axes: ['voice', 'focus'], location: null };
const walk: TaskResources = { axes: ['self'], location: null };
const gym: TaskResources = { axes: ['self'], location: 'gym' };
const store: TaskResources = { axes: ['self'], location: 'store' };

ok('two focus conflict', canCoexist(focus, focus) === false);
ok('focus + passive parallel', canCoexist(focus, passive) === true);
ok('call + walk parallel', canCoexist(callR, walk) === true);
ok('call + meeting(focus+voice) conflict', canCoexist(callR, { axes: ['focus', 'voice', 'self'], location: null }) === false);
ok('gym + store conflict (self + diff location)', canCoexist(gym, store) === false);
// Location implies `self`, so two in-person things even at the SAME place still need you → conflict.
ok('same location still conflicts (both need you)', canCoexist({ axes: [], location: 'office' }, { axes: [], location: 'office' }) === false);
// A non-self resource (e.g. a download tagged to a place) can still parallel if it holds no self.
ok('passive overlaps an in-person block', canCoexist(passive, gym) === true);
ok('location implies self', normalizeResources({ axes: [], location: 'gym' }).axes.includes('self'));

// ── classifier sanity ──────────────────────────────────────────────────────────
ok('deep work classified focus/deep', (() => { const m = classifyTask('write the design doc'); return m.energy === 'deep' && m.resources.axes.includes('focus'); })());
ok('laundry is passive', (() => { const m = classifyTask('do the laundry'); return m.energy === 'passive' && m.resources.axes.length === 0; })());
ok('call classified voice', (() => { const m = classifyTask('call the dentist'); return m.resources.axes.includes('voice'); })());
ok('gym classified location', (() => { const m = classifyTask('go to the gym'); return m.resources.location === 'gym'; })());
ok('unknown defaults conservative', (() => { const m = classifyTask('xyzzy plugh'); return m.resources.axes.includes('focus') && m.resources.axes.includes('self'); })());

// ── findSlots respects the invariant ────────────────────────────────────────────
const day = startOfLocalDay(Date.now()) + 24 * 60 * MIN; // tomorrow midnight
const now = startOfLocalDay(Date.now()) + 8 * 60 * MIN;   // today 08:00 baseline
const hard = nonWorkingBlocks(AV, now, now + 3 * 24 * 60 * MIN);

// A busy focus meeting tomorrow 10:00-11:00.
const meeting: Block = {
  title: 'Meeting', start: day + 10 * 60 * MIN, end: day + 11 * 60 * MIN,
  resources: { axes: ['focus', 'self'], location: null }, source: 'calendar',
};

const deepTask: SchedTaskMeta = { title: 'Deep work', durationMin: 60, resources: focus, energy: 'deep', confidence: 0.8 };
const slots = findSlots({ meta: deepTask, hardBlocks: hard, resourceBlocks: [meeting], availability: AV, now });
ok('found at least one slot', slots.length > 0);
ok('no slot overlaps the focus meeting', !slots.some((s) => overlaps(s.start, s.end, meeting.start, meeting.end)));
ok('no slot inside off-hours/sleep', !slots.some((s) => hard.some((h) => overlaps(s.start, s.end, h.start, h.end))));
ok('slots respect working hours', slots.every((s) => { const lm = new Date(s.start).getHours() * 60 + new Date(s.start).getMinutes(); return lm >= AV.workStartMin; }));

// A passive task CAN overlap the meeting (parallel allowed) but still not sleep.
const passiveTask: SchedTaskMeta = { title: 'Laundry', durationMin: 45, resources: passive, energy: 'passive', confidence: 0.8 };
const pslots = findSlots({ meta: passiveTask, hardBlocks: hard, resourceBlocks: [meeting], availability: AV, now });
ok('passive task gets slots', pslots.length > 0);
ok('passive never inside sleep/off-hours', !pslots.some((s) => hard.some((h) => overlaps(s.start, s.end, h.start, h.end))));

// ── explicit "after 6:30pm" time constraint (the reported bug) ───────────────────
const gymTask = classifyTask('gym every evening for 1 hr after 6:30 pm');
ok('parses "after 6:30 pm" → 18:30', gymTask.earliestMin === 18 * 60 + 30);
const gymSlots = findSlots({ meta: { ...gymTask, durationMin: 60 }, hardBlocks: hard, resourceBlocks: [], availability: AV, now });
ok('gym got slots even though after work hours', gymSlots.length > 0);
ok('all gym slots start at/after 6:30pm', gymSlots.every((s) => { const lm = new Date(s.start).getHours() * 60 + new Date(s.start).getMinutes(); return lm >= 18 * 60 + 30; }));
const before = classifyTask('finish report before 11am');
ok('parses "before 11am" → 11:00', before.latestMin === 11 * 60);

// ── validatePlan catches a manual clash ─────────────────────────────────────────
const clash: Block = { title: 'Clash', start: meeting.start + 15 * MIN, end: meeting.end + 15 * MIN, resources: focus, source: 'scheduled' };
ok('validatePlan flags overlapping focus blocks', validatePlan([meeting, clash]).length === 1);
ok('validatePlan ignores parallel-OK overlap', validatePlan([meeting, { ...clash, resources: passive }]).length === 0);

console.log(`\nCalendar engine: ${pass} passed, ${fail} failed.`);
process.exit(fail === 0 ? 0 : 1);
