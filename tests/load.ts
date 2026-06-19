/* Pure tests for the effort-load scheduler model. Run: npx tsx tests/load.ts */
import { loadOf, canParallelize, rollingExtremes, scoreLoad, capacityAt, BRAIN_CAP, type BlockLoad } from '../src/scheduling/load';
import { classifyTask } from '../src/scheduling/classify';
import type { AvailabilityProfile } from '../src/scheduling/types';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean) { if (cond) { pass++; } else { fail++; console.error('FAIL:', name); } }

const HOUR = 60 * 60 * 1000;

// ── loadOf composition ──────────────────────────────────────────────────────────
ok('deep work is brain-heavy', (() => { const l = loadOf('write the design doc', { axes: ['focus'], location: null }, 'deep'); return l.brain >= 0.8 && l.muscle <= 0.2; })());
ok('gym is muscle-heavy', (() => { const l = loadOf('go to the gym', { axes: ['self'], location: 'gym' }); return l.muscle >= 0.8 && l.brain <= 0.2; })());
ok('meeting is high attention', (() => { const l = loadOf('standup call', { axes: ['voice', 'focus'], location: null }); return l.attention >= 0.7; })());
ok('youtube is low attention', (() => { const l = loadOf('watch youtube watchlist', { axes: [], location: null }, 'passive'); return l.attention <= 0.3; })());

// ── parallelism: low-attention leisure rides alongside ───────────────────────────
ok('youtube parallelizable', canParallelize(loadOf('watch youtube', { axes: [], location: null }, 'passive')));
ok('deep work NOT parallelizable', !canParallelize(loadOf('code the parser', { axes: ['focus'], location: null }, 'deep')));
// The classifier should now treat a YouTube watchlist as parallelizable (no exclusive focus axis).
ok('classify: youtube watchlist → no focus axis', (() => { const m = classifyTask('watch my youtube watchlist'); return !m.resources.axes.includes('focus'); })());
ok('classify: gym still self/location', (() => { const m = classifyTask('go to the gym'); return m.resources.location === 'gym'; })());

// ── rolling sustainability ───────────────────────────────────────────────────────
const deepLoad = { brain: 0.9, muscle: 0.1, attention: 0.85 };
// A lone 1h deep task in an empty calendar averages 0.3 brain over 3h → sustainable.
ok('lone deep task sustainable', rollingExtremes(0, HOUR, deepLoad, []).brain <= BRAIN_CAP);
// Three back-to-back hours of deep work → ~0.9 brain avg over the 3h window → unsustainable.
const priorDeep: BlockLoad[] = [
  { start: -2 * HOUR, end: -HOUR, brain: 0.9, muscle: 0.1, attention: 0.85 },
  { start: -HOUR, end: 0, brain: 0.9, muscle: 0.1, attention: 0.85 },
];
ok('stacked deep work exceeds brain cap', rollingExtremes(0, HOUR, deepLoad, priorDeep).brain > BRAIN_CAP);

// scoreLoad: stacking deep work is penalized; spacing it is not.
const stacked = scoreLoad({ brain: 0.9, muscle: 0.1, attention: 0.85 }, 0, HOUR, priorDeep);
ok('stacked deep work penalized', stacked.delta < 0);
const spaced = scoreLoad({ brain: 0.9, muscle: 0.1, attention: 0.85 }, 0, HOUR, []);
ok('spaced deep work not penalized', spaced.delta >= 0);
ok('spaced deep work explains itself', spaced.reasons.some((r) => /sustainable/i.test(r)));

// A brain task right after a body task is fine (different efforts don't stack).
const priorGym: BlockLoad[] = [{ start: -HOUR, end: 0, brain: 0.15, muscle: 0.85, attention: 0.4 }];
ok('brain after body is sustainable', scoreLoad({ brain: 0.9, muscle: 0.1, attention: 0.85 }, 0, HOUR, priorGym).delta >= 0);

// ── time-varying capacity (peak high, dip low, sleep zero) ───────────────────────
const AV: AvailabilityProfile = {
  workStartMin: 9 * 60, workEndMin: 18 * 60, sleepStartMin: 23 * 60, sleepEndMin: 7 * 60,
  bufferMin: 10, maxFocusMinPerDay: 240, workDays: [1, 2, 3, 4, 5], protectedWindows: [],
  peakWindows: [{ label: 'AM', startMin: 7 * 60, endMin: 10 * 60 }],
  lowWindows: [{ label: 'Dip', startMin: 15 * 60, endMin: 18 * 60 }],
  inferred: false, confirmedAt: null,
};
const at = (h: number) => { const d = new Date(); d.setHours(h, 0, 0, 0); return d.getTime(); };
ok('peak capacity is high', capacityAt(AV, at(8)).brain >= 0.8);
ok('dip capacity is low', capacityAt(AV, at(16)).brain <= 0.45);
ok('sleep capacity is zero', capacityAt(AV, at(3)).brain === 0 && capacityAt(AV, at(3)).attention === 0);
ok('baseline capacity between', (() => { const c = capacityAt(AV, at(12)).brain; return c > 0.45 && c < 0.8; })());
// Same stacked deep work: penalized HARDER in the dip (low cap) than in the peak (high cap).
const stackPeak = scoreLoad({ brain: 0.9, muscle: 0.1, attention: 0.85 }, 0, HOUR, priorDeep, capacityAt(AV, at(8)));
const stackDip = scoreLoad({ brain: 0.9, muscle: 0.1, attention: 0.85 }, 0, HOUR, priorDeep, capacityAt(AV, at(16)));
ok('dip penalizes deep work more than peak', stackDip.delta < stackPeak.delta);

// ── user-shaped custom curves override the learned peak/dip ───────────────────────
const flat = new Array(24).fill(0.5);
const customLow = [...flat]; customLow[8] = 0.2; // brain dips hard at 8am in the user's own curve
const AV2: AvailabilityProfile = { ...AV, energyCurves: { brain: customLow, muscle: flat, attention: flat } };
ok('custom curve used at 8am', Math.abs(capacityAt(AV2, at(8)).brain - 0.2) < 1e-9);
ok('custom curve used midday', Math.abs(capacityAt(AV2, at(12)).brain - 0.5) < 1e-9);
ok('sleep still zero with custom curve', capacityAt(AV2, at(3)).brain === 0);

console.log(`\nload model: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
