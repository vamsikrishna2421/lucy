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
import { computeStart } from '../src/voice/timeResolve';
import { spendingWindow, recognizesSchedulingQuestion, recognizesTodayPlanQuestion, isComplexOrEmotionalQuery } from '../src/processing/askIntent';
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

// ── computeStart (voice scheduling day/time resolution) ───────────────────────
// NOW = Wed 2026-06-17 10:00 local.
ok('computeStart null when no time', computeStart('monday', null, NOW) === null);
ok('computeStart null on bad time', computeStart('monday', '25:99', NOW) === null);
{
  // "next Tuesday at 15:00" must NOT be today (the bug) — Tue is 2026-06-23.
  const t = computeStart('next tuesday', '15:00', NOW);
  ok('next tuesday resolves to a Tuesday', t !== null && new Date(t).getDay() === 2);
  ok('next tuesday is in the future', t !== null && t > NOW);
  ok('next tuesday is the 23rd', t !== null && new Date(t).getDate() === 23);
}
{
  // bare "friday" → upcoming Friday 2026-06-19
  const t = computeStart('friday', '09:00', NOW);
  ok('friday → Fri the 19th', t !== null && new Date(t).getDay() === 5 && new Date(t).getDate() === 19);
}
{
  // same weekday as today ("wednesday") → next week's Wed (24th), never today
  const t = computeStart('wednesday', '14:00', NOW);
  ok('wednesday (today is Wed) → next Wed 24th', t !== null && new Date(t).getDate() === 24);
}
{
  const t = computeStart('tomorrow', '08:30', NOW);
  ok('tomorrow → 18th 08:30', t !== null && new Date(t).getDate() === 18 && new Date(t).getHours() === 8);
}
{
  // explicit past time today rolls to tomorrow
  const t = computeStart('today', '09:00', NOW); // 9am already passed (now 10am)
  ok('today past time rolls to tomorrow', t !== null && new Date(t).getDate() === 18);
}
ok('explicit ISO date honored', (() => { const t = computeStart('2026-07-04', '12:00', NOW); return t !== null && new Date(t).getMonth() === 6 && new Date(t).getDate() === 4; })());

// ── spendingWindow (scope parsing — "last week" must not become all-time) ─────
ok('spend last week → week', spendingWindow('how much did I spend last week?').kind === 'week');
ok('spend this week → week', spendingWindow('my spending this week').kind === 'week');
ok('spend this month → month', spendingWindow('how much this month?').kind === 'month');
ok('spend last month → lastMonth', spendingWindow('what did I spend last month').kind === 'lastMonth');
ok('spend today → today', spendingWindow('how much have I spent today').kind === 'today');
ok('spend this year → year', spendingWindow('total this year').kind === 'year');
ok('spend in total → all', spendingWindow('how much have I spent in total').kind === 'all');
ok('spend overall → all', spendingWindow('my overall spending').kind === 'all');
ok('spend no-period defaults all', spendingWindow('how much did I spend on food').kind === 'all');
ok('spendingWindow has a human label', spendingWindow('last week').label === 'the last 7 days');

// ── Ask intent routing (gap-report fixes: don't hijack emotional/long messages) ───
const RANT = 'ok so today was a lot, woke up late, the genie demo got pushed, laundry is piling up, chicago flight still not booked, stressed about money, need to call my mom, honestly i dont even know where to start';
ok('long stressed rant → complex (LLM, not today-stats)', isComplexOrEmotionalQuery(RANT));
// A rant that ALSO contains the today+task keywords must still go to the LLM — the complex guard runs
// FIRST in askLucy, so it wins over recognizesTodayPlanQuestion. This is the core #1 fix.
const RANT2 = `${RANT} and i have so many pending tasks for today`;
ok('rant w/ today+task keywords trips the today detector', recognizesTodayPlanQuestion(RANT2) === true);
ok('…but complex guard also fires (and runs first → LLM)', isComplexOrEmotionalQuery(RANT2) === true);
ok('short "what are my tasks for today" → NOT complex', isComplexOrEmotionalQuery('what are my tasks for today') === false);
ok('"i feel overwhelmed" → complex', isComplexOrEmotionalQuery('i feel overwhelmed with everything'));
ok('"how much did I spend?" → not complex', isComplexOrEmotionalQuery('how much did I spend last week') === false);
ok('"plan my day" NOT a single-task scheduling question', recognizesSchedulingQuestion('plan my day for me') === false);
ok('"find time to call mom" still scheduling', recognizesSchedulingQuestion('find time to call mom') === true);
ok('"schedule a dentist appointment" still scheduling', recognizesSchedulingQuestion('schedule a dentist appointment') === true);

console.log(`\nhardening: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
