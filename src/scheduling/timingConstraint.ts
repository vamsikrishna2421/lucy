/**
 * Parse a natural-language timing comment on a scheduling suggestion ("not tomorrow", "last week of
 * this month", "next week", "after the 25th") into a date WINDOW the scheduler can honor. Pure +
 * unit-tested. Returns an earliestStart (ms) + horizonDays so findSlots searches inside that window.
 */
export interface TimingConstraint {
  earliestStart: number;   // ms epoch — don't suggest before this
  horizonDays: number;     // how many days from today to search through (covers the window end)
  label: string;           // human label echoed back ("last week of June")
}

const DAY = 86_400_000;
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

function startOfDay(d: Date): number { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); }
function daysFromToday(ms: number, now: number): number { return Math.max(1, Math.ceil((ms - startOfDay(new Date(now))) / DAY)); }

export function parseTimingConstraint(text: string, now = Date.now()): TimingConstraint | null {
  const q = (text || '').toLowerCase();
  const today = new Date(now);
  const y = today.getFullYear();
  const m = today.getMonth();
  const lastDay = new Date(y, m + 1, 0).getDate();
  const monthName = MONTHS[m].charAt(0).toUpperCase() + MONTHS[m].slice(1);

  // "last week of (this) month" / "end of (this) month" → the final 7 days of the current month.
  if (/\b(last week of (the |this )?month|end of (the |this )?month|month'?s end)\b/.test(q)) {
    const startDay = Math.max(1, lastDay - 6);
    const start = startOfDay(new Date(y, m, startDay));
    const end = new Date(y, m, lastDay).getTime();
    return { earliestStart: Math.max(start, now + 10 * 60_000), horizonDays: daysFromToday(end, now), label: `the last week of ${monthName}` };
  }

  // "next month"
  if (/\bnext month\b/.test(q)) {
    const start = startOfDay(new Date(y, m + 1, 1));
    return { earliestStart: start, horizonDays: daysFromToday(start + 13 * DAY, now), label: 'next month' };
  }

  // "next week" → next Monday, 7-day window.
  if (/\bnext week\b/.test(q)) {
    const d = new Date(today); const add = ((1 - d.getDay() + 7) % 7) || 7; d.setDate(d.getDate() + add);
    const start = startOfDay(d);
    return { earliestStart: start, horizonDays: daysFromToday(start + 6 * DAY, now), label: 'next week' };
  }

  // "this weekend" / "weekend" → upcoming Saturday.
  if (/\b(this )?weekend\b/.test(q)) {
    const d = new Date(today); const add = ((6 - d.getDay() + 7) % 7); d.setDate(d.getDate() + add);
    const start = startOfDay(d);
    return { earliestStart: Math.max(start, now), horizonDays: daysFromToday(start + 1 * DAY, now), label: 'this weekend' };
  }

  // "after the 25th" / "on the 25th" / "the 25th" → that calendar day (this month, or next if passed).
  const dm = q.match(/\b(?:after |on |by )?the (\d{1,2})(?:st|nd|rd|th)?\b/);
  if (dm) {
    const day = Number(dm[1]);
    if (day >= 1 && day <= 31) {
      let target = new Date(y, m, day);
      if (startOfDay(target) < startOfDay(today)) target = new Date(y, m + 1, day); // already passed → next month
      const start = startOfDay(target);
      return { earliestStart: start, horizonDays: daysFromToday(start + 3 * DAY, now), label: `the ${day}${ordinal(day)}` };
    }
  }

  // "not tomorrow" → start the day after tomorrow.
  if (/\bnot tomorrow\b/.test(q)) {
    const start = startOfDay(today) + 2 * DAY;
    return { earliestStart: start, horizonDays: daysFromToday(start + 6 * DAY, now), label: 'after tomorrow' };
  }

  // "next/later this week" → start tomorrow, week window.
  if (/\b(later this week|rest of (the |this )?week)\b/.test(q)) {
    const start = startOfDay(today) + 1 * DAY;
    return { earliestStart: start, horizonDays: daysFromToday(start + 5 * DAY, now), label: 'later this week' };
  }

  return null;
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']; const v = n % 100;
  return s[(v - 20) % 10] ?? s[v] ?? s[0];
}
