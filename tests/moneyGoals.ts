/* Pure tests for money goals / runway math. Run: npx tsx tests/moneyGoals.ts */
import { computeGoalProgress, goalGuidance, formatMoney, type GoalContribution } from '../src/processing/moneyGoals';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean) { if (cond) { pass++; } else { fail++; console.error('FAIL:', name); } }
const approx = (a: number, b: number, eps = 1) => Math.abs(a - b) <= eps;

const DAY = 86_400_000;
const WEEK = 7 * DAY;
const now = Date.parse('2026-06-19T12:00:00.000Z');
const iso = (msFromNow: number) => new Date(now + msFromNow).toISOString();
const contribs = (...amts: number[]): GoalContribution[] => amts.map((amount) => ({ amount, created_at: iso(-WEEK) }));

// saved sums contributions; remaining + pct.
{
  const p = computeGoalProgress(2000, contribs(500, 500), iso(-4 * WEEK), null, now);
  ok('sums contributions', p.saved === 1000);
  ok('remaining = target − saved', p.remaining === 1000);
  ok('pct = 0.5', approx(p.pct, 0.5, 0.001));
  ok('no deadline → daysLeft null', p.daysLeft === null);
  ok('no deadline → onTrack null', p.onTrack === null);
  ok('pace = 1000 / 4 weeks = 250', approx(p.perWeekPace, 250));
}

// done when saved >= target.
{
  const p = computeGoalProgress(2000, contribs(1200, 900), iso(-2 * WEEK), iso(2 * WEEK), now);
  ok('done when saved >= target', p.done === true);
  ok('remaining clamps at 0 when over', p.remaining === 0);
  ok('done → onTrack true', p.onTrack === true);
}

// on-track: 4 wks in, 4 wks left (8 total), saved 1000 → pace 250 → projected 2000 ≥ 2000.
{
  const p = computeGoalProgress(2000, contribs(1000), iso(-4 * WEEK), iso(4 * WEEK), now);
  ok('on-track projectedTotal ~2000', approx(p.projectedTotal ?? 0, 2000, 5));
  ok('on-track onTrack true', p.onTrack === true);
  ok('perWeekNeeded = 1000 remaining / 4 wks = 250', approx(p.perWeekNeeded ?? 0, 250, 2));
  ok('daysLeft ~28', approx(p.daysLeft ?? 0, 28, 1));
}

// behind: 4 wks in, 1 wk left, saved 500 → pace 125 → projected ~625 < 2000.
{
  const p = computeGoalProgress(2000, contribs(500), iso(-4 * WEEK), iso(1 * WEEK), now);
  ok('behind onTrack false', p.onTrack === false);
  ok('behind perWeekNeeded = 1500 / 1wk', approx(p.perWeekNeeded ?? 0, 1500, 5));
}

// past deadline: daysLeft negative.
{
  const p = computeGoalProgress(2000, contribs(800), iso(-6 * WEEK), iso(-1 * WEEK), now);
  ok('past deadline → daysLeft negative', (p.daysLeft ?? 0) < 0);
}

// formatMoney + guidance phrasing.
ok('formatMoney default ₹', formatMoney(1500) === '₹1,500');
ok('formatMoney custom currency', formatMoney(2000, '$') === '$2,000');
{
  const done = computeGoalProgress(1000, contribs(1000), iso(-2 * WEEK), iso(WEEK), now);
  ok('guidance: done mentions hit', /hit your Move fund goal/.test(goalGuidance('Move fund', done, '$', now)));
  const behind = computeGoalProgress(2000, contribs(200), iso(-4 * WEEK), iso(WEEK), now);
  ok('guidance: behind says behind + need', /^Behind on Move fund/.test(goalGuidance('Move fund', behind, '$', now)));
  const noDl = computeGoalProgress(2000, contribs(500), iso(-4 * WEEK), null, now);
  ok('guidance: no deadline mentions no deadline', /No deadline yet/.test(goalGuidance('Move fund', noDl, '$', now)));
}

console.log(`\nmoneyGoals: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
