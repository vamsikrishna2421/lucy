/**
 * Reminder recurrence — pure helpers for repeating reminders.
 *
 * Reminders used to be one-shot: "remind me on the 5th, 15th and 25th" produced three reminders for
 * the CURRENT month only and never came back. With a recurrence rule, when a reminder fires (or is
 * acknowledged) it advances to its NEXT occurrence instead of being consumed — so a monthly reminder
 * on the 5th regenerates next month's 5th automatically.
 *
 * Everything here is pure (no DB, no native) so it's unit-testable with `npx tsx tests/reminders.ts`.
 */

export type ReminderRecurrence = 'daily' | 'weekdays' | 'weekly' | 'monthly';

const RECURRENCES: ReminderRecurrence[] = ['daily', 'weekdays', 'weekly', 'monthly'];

/** Narrow an arbitrary string (e.g. a DB value) to a valid recurrence, or null. */
export function asReminderRecurrence(v: string | null | undefined): ReminderRecurrence | null {
  return v && (RECURRENCES as string[]).includes(v) ? (v as ReminderRecurrence) : null;
}

/**
 * Detect a recurrence intent in free text. Superset of the calendar's detectRecurrence — adds
 * "monthly" (incl. "every month", "on the 5th of every month", "every 1st"). Order matters:
 * check the more specific patterns first.
 */
export function detectReminderRecurrence(text: string): ReminderRecurrence | null {
  const t = text || '';
  if (/\b(every weekday|on weekdays|each weekday|weekdays only)\b/i.test(t)) return 'weekdays';
  if (/\b(every month|each month|monthly|every \d{1,2}(st|nd|rd|th)\b|on the \d{1,2}(st|nd|rd|th)( of (every|each) month)?)\b/i.test(t)) return 'monthly';
  if (/\b(every week|each week|weekly)\b/i.test(t)) return 'weekly';
  if (/\b(every ?day|everyday|daily|each day|every morning|every evening|every night|each night)\b/i.test(t)) return 'daily';
  return null;
}

/** Clamp a day-of-month to the target month's length (e.g. the 31st in February → 28/29). */
function clampDayToMonth(year: number, monthIndex0: number, day: number): number {
  const daysInMonth = new Date(year, monthIndex0 + 1, 0).getDate();
  return Math.min(day, daysInMonth);
}

/**
 * Given the current occurrence (ms epoch) and a recurrence rule, return the NEXT occurrence (ms),
 * strictly after `current`, preserving the time-of-day. Returns null for an unknown rule.
 *
 * - daily:    +1 day
 * - weekly:   +7 days
 * - weekdays: next day, skipping Sat/Sun
 * - monthly:  same day-of-month next month, clamped to month length (Jan 31 → Feb 28/29)
 */
export function computeNextReminderOccurrence(current: number, recurrence: ReminderRecurrence): number | null {
  if (!Number.isFinite(current)) return null;
  const d = new Date(current);

  switch (recurrence) {
    case 'daily':
      d.setDate(d.getDate() + 1);
      return d.getTime();

    case 'weekly':
      d.setDate(d.getDate() + 7);
      return d.getTime();

    case 'weekdays': {
      do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6); // skip Sun/Sat
      return d.getTime();
    }

    case 'monthly': {
      const targetDay = d.getDate();
      // Move to the 1st to avoid overflow (e.g. adding a month to Jan 31), advance, then re-apply day.
      d.setDate(1);
      d.setMonth(d.getMonth() + 1);
      d.setDate(clampDayToMonth(d.getFullYear(), d.getMonth(), targetDay));
      return d.getTime();
    }

    default:
      return null;
  }
}

/**
 * Advance a recurring reminder forward until its next occurrence is in the FUTURE relative to `now`
 * (handles a device that was off for several cycles — e.g. a daily reminder missed for a week).
 * Returns the next future occurrence ms, or null if not recurring.
 */
export function nextFutureOccurrence(current: number, recurrence: ReminderRecurrence | null, now = Date.now()): number | null {
  if (!recurrence) return null;
  let next = computeNextReminderOccurrence(current, recurrence);
  let guard = 0;
  while (next !== null && next <= now && guard < 1000) {
    next = computeNextReminderOccurrence(next, recurrence);
    guard += 1;
  }
  return next;
}

/** Human label for UI ("Daily", "Every weekday", "Weekly", "Monthly"). */
export function recurrenceLabel(recurrence: ReminderRecurrence | null): string {
  switch (recurrence) {
    case 'daily': return 'Daily';
    case 'weekdays': return 'Every weekday';
    case 'weekly': return 'Weekly';
    case 'monthly': return 'Monthly';
    default: return '';
  }
}
