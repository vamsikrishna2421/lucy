/**
 * Adversarial hardening tests for the pure date + scheduling core (the bits that feed reminders and
 * the conflict-free calendar). Run: npx tsx tests/hardening.ts
 *
 * Goal: throw nasty / boundary inputs at the exported pure functions and assert clearly-correct
 * invariants, so a future change that breaks them is caught.
 */
import { parseDeadline, detectRecurrence } from '../src/scheduling/classify';
import { overlaps } from '../src/scheduling/time';
import { canCoexist, normalizeResources } from '../src/scheduling/resources';
import type { TaskResources } from '../src/scheduling/types';

let pass = 0; let fail = 0;
function ok(name: string, cond: boolean) { if (cond) { pass++; } else { fail++; console.error('  ✗ FAIL:', name); } }

// Fixed reference: Wed 2026-06-17 10:00 local
const NOW = new Date(2026, 5, 17, 10, 0, 0, 0).getTime();
const localDate = (iso: string) => new Date(iso); // parseDeadline returns ISO (UTC); compare via Date

// ── parseDeadline ─────────────────────────────────────────────────────────────
ok('deadline empty → null', parseDeadline('', NOW) === null);
ok('deadline gibberish → null', parseDeadline('asdf qwerty', NOW) === null);
ok('deadline "next week" unhandled → null (known limitation)', parseDeadline('finish by next week', NOW) === null);

{
  const today = parseDeadline('today', NOW);
  ok('today returns ISO', typeof today === 'string');
  const d = localDate(today!);
  ok('today is same calendar day', d.getFullYear() === 2026 && d.getMonth() === 5 && d.getDate() === 17);
  ok('today set to 23:59 local', d.getHours() === 23 && d.getMinutes() === 59);
}
{
  const tom = localDate(parseDeadline('do it tomorrow', NOW)!);
  ok('tomorrow is the 18th', tom.getDate() === 18 && tom.getMonth() === 5);
}
{
  // 2026-06-17 is a Wednesday. "by monday" → next Monday (2026-06-22).
  const mon = localDate(parseDeadline('submit by monday', NOW)!);
  ok('by monday → a Monday', mon.getDay() === 1);
  ok('by monday → future (not today)', mon.getTime() > NOW);
}
{
  // Same-weekday edge: "by wednesday" when today IS Wednesday → next week, never today.
  const wed = localDate(parseDeadline('by wednesday', NOW)!);
  ok('by wednesday (today is Wed) → next Wed, not today', wed.getDate() === 24);
}
ok('tonight → today 23:59', localDate(parseDeadline('tonight', NOW)!).getDate() === 17);
ok('eod → today', localDate(parseDeadline('eod', NOW)!).getDate() === 17);

// ── detectRecurrence (calendar) ───────────────────────────────────────────────
ok('recurrence daily', detectRecurrence('go for a walk every day') === 'daily');
ok('recurrence weekdays', detectRecurrence('standup every weekday') === 'weekdays');
ok('recurrence weekly', detectRecurrence('review weekly') === 'weekly');
ok('recurrence none', detectRecurrence('one off task tomorrow') === null);

// ── overlaps (boundary correctness) ───────────────────────────────────────────
ok('touching intervals do NOT overlap [0,10)&[10,20)', overlaps(0, 10, 10, 20) === false);
ok('clear overlap [0,10)&[9,20)', overlaps(0, 10, 9, 20) === true);
ok('contained interval overlaps', overlaps(0, 100, 40, 60) === true);
ok('disjoint do not overlap', overlaps(0, 10, 20, 30) === false);
ok('reverse-order args still detect overlap', overlaps(9, 20, 0, 10) === true);
ok('zero-width interval at boundary does not overlap', overlaps(10, 10, 10, 20) === false);

// ── canCoexist / resource model invariants ────────────────────────────────────
const focus: TaskResources = { axes: ['focus'], location: null };
const passive: TaskResources = { axes: [], location: null };
const walk: TaskResources = { axes: ['self'], location: null };
ok('two focus cannot coexist', canCoexist(focus, focus) === false);
ok('focus + passive can coexist', canCoexist(focus, passive) === true);
ok('two self (you) cannot coexist', canCoexist(walk, walk) === false);
ok('passive + passive can coexist (nothing exclusive)', canCoexist(passive, passive) === true);
ok('location implies self axis', normalizeResources({ axes: [], location: 'gym' }).axes.includes('self'));
ok('canCoexist is symmetric', canCoexist(focus, walk) === canCoexist(walk, focus));

console.log(`\nhardening: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
