/* Pure tests for the mood-graph series + shift detector. Run: npx tsx tests/moodGraph.ts */
import { toneValence, buildSeries, detectShift } from '../src/processing/moodGraph';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean) { if (cond) { pass++; } else { fail++; console.error('FAIL:', name); } }

const DAY = 86_400_000;
const now = (() => { const d = new Date(); d.setHours(12, 0, 0, 0); return d.getTime(); })();
function row(tone: string, daysAgo: number) {
  return { tone, created_at: new Date(now - daysAgo * DAY).toISOString().slice(0, 19).replace('T', ' ') };
}

// Valence mapping.
ok('excited is high', toneValence('excited') === 2);
ok('depressed is low', toneValence('depressed') === -2);
ok('neutral is zero', toneValence('neutral') === 0);
ok('unknown tone → 0', toneValence('zorp') === 0);

// Series is continuous over the window with gaps as null.
const rows = [row('stressed', 9), row('low', 8), row('happy', 2), row('excited', 1)];
const series = buildSeries(rows, 10, now);
ok('one point per day', series.length === 10);
ok('empty days are null', series.some((p) => p.score === null));
ok('recent day positive', (() => { const w = series.filter((p) => p.score != null); return (w[w.length - 1].score ?? 0) > 0; })());
ok('older day negative', (() => { const p = series.find((x) => x.count > 0); return p != null && (p.score ?? 0) < 0; })());

// Shift detection: low last week → happy this week = an upturn.
const upRows = [
  row('depressed', 12), row('low', 11), row('stressed', 10), row('low', 9),
  row('calm', 3), row('happy', 2), row('excited', 1), row('positive', 0),
];
const up = detectShift(buildSeries(upRows, 13, now));
ok('detects upturn', up.direction === 'up' && up.delta > 0);
ok('upturn names a day', !!up.sinceDate && /lifted/i.test(up.message));

// Steady mood → flat (no false alarm).
const flatRows = [row('calm', 6), row('content', 5), row('calm', 3), row('content', 1)];
const flat = detectShift(buildSeries(flatRows, 7, now));
ok('steady mood is flat', flat.direction === 'flat');

console.log(`\nmoodGraph: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
