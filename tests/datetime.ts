/* Pure tests for the shared db-date helper. Run: npx tsx tests/datetime.ts */
import { parseDbDate, dbDateMs, daysSinceDb } from '../src/utils/datetime';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean) { if (cond) { pass++; } else { fail++; console.error('FAIL:', name); } }

// A SQLite UTC stamp (no zone) must be read as UTC, not local.
const sqlite = '2026-06-20 08:30:00';
ok('SQLite stamp parsed as UTC', parseDbDate(sqlite).getTime() === Date.UTC(2026, 5, 20, 8, 30, 0));

// An already-ISO UTC string is trusted as-is (same instant).
ok('ISO Z string matches the SQLite UTC instant', parseDbDate('2026-06-20T08:30:00Z').getTime() === Date.UTC(2026, 5, 20, 8, 30, 0));

// The zone-less and the explicit-Z forms agree (the whole point of the helper).
ok('zoneless and Z forms agree', parseDbDate(sqlite).getTime() === parseDbDate('2026-06-20T08:30:00Z').getTime());

// dbDateMs mirrors parseDbDate.
ok('dbDateMs matches', dbDateMs(sqlite) === parseDbDate(sqlite).getTime());

// NaN-safety.
ok('empty → invalid date', Number.isNaN(parseDbDate('').getTime()));
ok('null → invalid date', Number.isNaN(parseDbDate(null).getTime()));
ok('daysSinceDb NaN-safe → 0', daysSinceDb('') === 0);

// daysSinceDb arithmetic.
const tenDaysAgo = Date.UTC(2026, 5, 10, 8, 30, 0);
ok('10 days since', daysSinceDb('2026-06-10 08:30:00', Date.UTC(2026, 5, 20, 8, 30, 0)) === 10);
ok('same instant → 0 days', daysSinceDb('2026-06-20 08:30:00', Date.UTC(2026, 5, 20, 8, 30, 0)) === 0);
void tenDaysAgo;

console.log(`\ndatetime: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
