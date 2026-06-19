/* Pure tests for parseDeadline (additive date parsing). Run: npx tsx tests/parseDeadline.ts */
import { parseDeadline } from '../src/scheduling/classify';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean) { if (cond) { pass++; } else { fail++; console.error('FAIL:', name); } }

const D = 86_400_000;
const now = new Date(2026, 5, 19, 12, 0, 0).getTime(); // Fri Jun 19 2026, local noon
const at = (iso: string | null) => (iso ? new Date(Date.parse(iso)) : null);
const dday = (iso: string | null) => (iso ? Math.round((Date.parse(iso) - now) / D) : NaN);

// ── existing formats UNCHANGED (regression guard) ──────────────────────────────────
ok('today resolves to today', at(parseDeadline('finish this today', now))?.toDateString() === new Date(now).toDateString());
ok('tomorrow ~ +1 day', dday(parseDeadline('do it tomorrow', now)) === 1);
{
  const f = parseDeadline('send the deck by friday', now);
  ok('by friday → a Friday', at(f)?.getDay() === 5);
  ok('by friday in the future', Date.parse(f!) > now);
}
ok('by thursday → Thursday', at(parseDeadline('email by thursday', now))?.getDay() === 4);

// ── NEW: next/this/on/coming <weekday> ──────────────────────────────────────────────
{
  const byFri = parseDeadline('by friday', now)!;
  const nextFri = parseDeadline("let's meet next friday", now)!;
  ok('next friday → a Friday', at(nextFri)?.getDay() === 5);
  ok('next friday is a week after "by friday"', Date.parse(nextFri) - Date.parse(byFri) === 7 * D);
}
ok('on monday → Monday', at(parseDeadline('due on monday', now))?.getDay() === 1);
ok('this wednesday → Wednesday', at(parseDeadline('this wednesday works', now))?.getDay() === 3);
ok('coming tuesday → Tuesday', at(parseDeadline('coming tuesday', now))?.getDay() === 2);

// ── NEW: in N days / weeks ──────────────────────────────────────────────────────────
ok('in 3 days → ~+3', dday(parseDeadline('due in 3 days', now)) === 3);
ok('in 2 weeks → ~+14', dday(parseDeadline('in 2 weeks', now)) === 14);
ok('in 10 days → ~+10', dday(parseDeadline('ready in 10 days', now)) === 10);

// ── NEW: month + day, both orders, with year rollover ───────────────────────────────
{
  const aug = parseDeadline('flying out Aug 31', now)!;
  ok('Aug 31 → August', at(aug)?.getMonth() === 7);
  ok('Aug 31 → day 31', at(aug)?.getDate() === 31);
  ok('Aug 31 → this year (future)', at(aug)?.getFullYear() === 2026);
}
{
  const augB = parseDeadline('lease ends 31 August', now)!;
  ok('31 August parses (day+month)', at(augB)?.getMonth() === 7 && at(augB)?.getDate() === 31);
}
ok('September 5th parses', at(parseDeadline('the gala is on September 5th', now))?.getMonth() === 8);
{
  const jan = parseDeadline('renew January 5', now)!; // Jan 5 already past in June → next year
  ok('January 5 rolls to next year', at(jan)?.getMonth() === 0 && at(jan)?.getDate() === 5 && Date.parse(jan) > now);
}

// ── NEW: "the Nth" (ordinal required) ───────────────────────────────────────────────
ok('the 15th → day 15', at(parseDeadline('rent due the 15th', now))?.getDate() === 15);
ok('the 15th is in the future', Date.parse(parseDeadline('rent due the 15th', now)!) > now);

// ── negatives (must stay null — no false positives) ─────────────────────────────────
ok('plain text → null', parseDeadline('had a great coffee with friends', now) === null);
ok('"the 2 items" is not a date', parseDeadline('pick up the 2 items', now) === null);
ok('"marketing 3 ideas" is not a month date', parseDeadline('discussed marketing 3 ideas', now) === null);
ok('"in 3 hours" not parsed (days/weeks only)', parseDeadline('back in 3 hours', now) === null);
ok('empty → null', parseDeadline('', now) === null);

console.log(`\nparseDeadline: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
