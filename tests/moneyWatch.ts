/* Pure-function tests for the money-watch engine. Run: npx tsx tests/moneyWatch.ts */
import { merchantKey, detectRecurring, forecastUpcomingBills, detectCategoryDrift, detectAnomalies } from '../src/processing/moneyWatch';
import type { ExpenseRow } from '../src/db/expenses';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean) { if (cond) { pass++; } else { fail++; console.error('FAIL:', name); } }

const DAY = 86_400_000;
function iso(msAgo: number): string {
  return new Date(Date.now() - msAgo).toISOString().slice(0, 19).replace('T', ' ');
}
let id = 1;
function exp(description: string, amount: number | null, category: string, daysAgo: number): ExpenseRow {
  return { id: id++, created_at: iso(daysAgo * DAY), amount, description, category, privacy_level: 'normal' };
}

// merchantKey strips amounts/punctuation/filler.
ok('merchantKey normalizes', merchantKey('Paid $9.99 for Netflix subscription') === 'netflix subscription');
ok('merchantKey stable across amounts', merchantKey('Snowflake cloud $120') === merchantKey('snowflake cloud - 145.50'));

// Recurring: 3 monthly Netflix charges → monthly cadence, next due ~30d after last.
const netflix = [exp('Netflix', 15.99, 'bills', 62), exp('Netflix', 15.99, 'bills', 31), exp('Netflix', 15.99, 'bills', 1)];
const rec = detectRecurring(netflix);
ok('detects one recurring charge', rec.length === 1);
ok('cadence monthly', rec[0]?.cadence === 'monthly');
ok('typical amount', rec[0]?.amount === 15.99);

// Forecast: next due is ~29 days out from last charge (1 day ago + 30d), so a 5-day horizon excludes it,
// but a charge last seen 29 days ago should show within horizon.
const dueSoon = [exp('Spotify', 11.99, 'bills', 59), exp('Spotify', 11.99, 'bills', 29)];
const recSoon = detectRecurring(dueSoon);
const bills = forecastUpcomingBills(recSoon, Date.now(), 5);
ok('forecasts an imminent bill', bills.length === 1 && /Spotify/i.test(bills[0]));

// One-off charges are NOT recurring.
const oneOffs = [exp('Random store', 40, 'shopping', 3), exp('Another store', 22, 'shopping', 10)];
ok('no recurring from one-offs', detectRecurring(oneOffs).length === 0);

// Anomaly: many small food charges + one huge one in last 7 days.
const food = [
  exp('Lunch', 12, 'food', 2), exp('Coffee', 6, 'food', 3), exp('Dinner', 18, 'food', 4),
  exp('Lunch', 14, 'food', 5), exp('Catering for party', 320, 'food', 1),
];
const anom = detectAnomalies(food);
ok('flags the anomalous charge', anom.length >= 1 && /320|Catering/i.test(anom[0]));

// No anomaly when there's no baseline.
ok('no anomaly without baseline', detectAnomalies([exp('Big one', 500, 'misc', 1)]).length === 0);

// Drift: build prior-2-months baseline ~ $100/mo food, this month already $400 early → drift.
const now = new Date();
function atMonthDay(monthsBack: number, day: number, amount: number, cat = 'food'): ExpenseRow {
  const d = new Date(now.getFullYear(), now.getMonth() - monthsBack, day, 12, 0, 0);
  return { id: id++, created_at: d.toISOString().slice(0, 19).replace('T', ' '), amount, description: 'eating out', category: cat, privacy_level: 'normal' };
}
const drift = [
  atMonthDay(1, 10, 50), atMonthDay(1, 20, 50),   // last month $100
  atMonthDay(2, 10, 50), atMonthDay(2, 20, 50),   // 2 months ago $100
  atMonthDay(0, 1, 200), atMonthDay(0, 2, 200),   // this month already $400
];
const driftMsgs = detectCategoryDrift(drift, now.getTime());
ok('detects category drift', driftMsgs.length >= 1 && /food/i.test(driftMsgs[0]));

console.log(`\nmoneyWatch: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
