/**
 * Reminder recurrence tests — pure logic (no DB/native).
 * Run: npx tsx tests/reminders.ts
 */
import {
  detectReminderRecurrence,
  computeNextReminderOccurrence,
  nextFutureOccurrence,
  asReminderRecurrence,
  recurrenceLabel,
} from '../src/processing/reminderRecurrence';

let pass = 0; let fail = 0;
function ok(name: string, cond: boolean) { if (cond) { pass++; } else { fail++; console.error('  ✗ FAIL:', name); } }
const day = (y: number, m: number, d: number, h = 9, min = 0) => new Date(y, m - 1, d, h, min, 0, 0).getTime();
const fmt = (ms: number | null) => (ms === null ? 'null' : new Date(ms).toLocaleString());

// ── detection ───────────────────────────────────────────────────────────────
ok('detect daily', detectReminderRecurrence('remind me every day to drink water') === 'daily');
ok('detect everyday', detectReminderRecurrence('water everyday') === 'daily');
ok('detect weekly', detectReminderRecurrence('call mom weekly') === 'weekly');
ok('detect weekdays', detectReminderRecurrence('standup every weekday at 9') === 'weekdays');
ok('detect monthly (every month)', detectReminderRecurrence('pay rent every month') === 'monthly');
ok('detect monthly (the 5th)', detectReminderRecurrence('pay the EMI on the 5th of every month') === 'monthly');
ok('detect monthly (every 15th)', detectReminderRecurrence('review budget every 15th') === 'monthly');
ok('weekdays beats weekly/daily', detectReminderRecurrence('every weekday') === 'weekdays');
ok('no recurrence', detectReminderRecurrence('remind me tomorrow at 5pm') === null);
ok('no recurrence plain', detectReminderRecurrence('buy milk') === null);

// ── computeNextReminderOccurrence ─────────────────────────────────────────────
ok('daily +1d', computeNextReminderOccurrence(day(2026, 6, 17, 9, 0), 'daily') === day(2026, 6, 18, 9, 0));
ok('weekly +7d', computeNextReminderOccurrence(day(2026, 6, 17), 'weekly') === day(2026, 6, 24));
ok('daily preserves time', new Date(computeNextReminderOccurrence(day(2026, 6, 17, 14, 30), 'daily')!).getHours() === 14);

// monthly: same day next month
ok('monthly 5th→5th', computeNextReminderOccurrence(day(2026, 1, 5), 'monthly') === day(2026, 2, 5));
// monthly month-end clamp: Jan 31 → Feb 28 (2026 not leap)
ok('monthly Jan31→Feb28 clamp', computeNextReminderOccurrence(day(2026, 1, 31), 'monthly') === day(2026, 2, 28));
// monthly Dec→Jan year rollover
ok('monthly Dec15→Jan15 next year', computeNextReminderOccurrence(day(2026, 12, 15), 'monthly') === day(2027, 1, 15));

// weekdays: Fri → Mon (skip weekend). 2026-06-19 is a Friday.
ok('weekdays Fri→Mon', new Date(computeNextReminderOccurrence(day(2026, 6, 19), 'weekdays')!).getDay() === 1);
// weekdays: Mon → Tue
ok('weekdays Mon→Tue', new Date(computeNextReminderOccurrence(day(2026, 6, 22), 'weekdays')!).getDay() === 2);
// weekdays: Sat → Mon
ok('weekdays Sat→Mon', new Date(computeNextReminderOccurrence(day(2026, 6, 20), 'weekdays')!).getDay() === 1);

// ── nextFutureOccurrence (catch up past missed cycles) ────────────────────────
{
  const start = day(2026, 6, 1, 9, 0);
  const now = day(2026, 6, 17, 12, 0); // ~16 days later
  const next = nextFutureOccurrence(start, 'daily', now);
  ok('daily catches up to future', next !== null && next > now);
  ok('daily catch-up lands on 18th 9am', next === day(2026, 6, 18, 9, 0));
}
{
  const start = day(2026, 1, 5, 8, 0);
  const now = day(2026, 6, 17, 12, 0);
  const next = nextFutureOccurrence(start, 'monthly', now);
  ok('monthly catches up to July 5', next === day(2026, 7, 5, 8, 0));
}
ok('nextFutureOccurrence null when no recurrence', nextFutureOccurrence(day(2026, 6, 1), null) === null);

// ── helpers ───────────────────────────────────────────────────────────────────
ok('asReminderRecurrence valid', asReminderRecurrence('monthly') === 'monthly');
ok('asReminderRecurrence invalid', asReminderRecurrence('yearly') === null);
ok('asReminderRecurrence empty', asReminderRecurrence('') === null);
ok('label monthly', recurrenceLabel('monthly') === 'Monthly');
ok('label none', recurrenceLabel(null) === '');

console.log(`\nreminders: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
