/**
 * Temporal anchor extraction.
 *
 * Detects when an event described in a capture HAPPENED (not when it was recorded)
 * and returns the appropriate Date. Used to backdate captures in the timeline.
 *
 * Examples:
 *   "Yesterday I met Marcus..." → yesterday's date
 *   "10 days ago I finished..." → 10 days ago
 *   "Last Monday standup..." → last Monday
 *   "On March 5 we decided..." → March 5 (current or nearest past year)
 *   "I had a meeting 3 weeks back..." → 3 weeks ago
 *
 * Returns null if no temporal anchor is detected (use capture time instead).
 */

const MONTHS: Record<string, number> = {
  january:1, jan:1, february:2, feb:2, march:3, mar:3, april:4, apr:4,
  may:5, june:6, jun:6, july:7, jul:7, august:8, aug:8,
  september:9, sep:9, sept:9, october:10, oct:10, november:11, nov:11, december:12, dec:12,
};

const WEEKDAYS: Record<string, number> = {
  sunday:0, sun:0, monday:1, mon:1, tuesday:2, tue:2,
  wednesday:3, wed:3, thursday:4, thu:4, friday:5, fri:5, saturday:6, sat:6,
};

function lastWeekday(dayOfWeek: number, fromDate: Date): Date {
  const result = new Date(fromDate);
  const diff = (fromDate.getDay() - dayOfWeek + 7) % 7 || 7;
  result.setDate(result.getDate() - diff);
  result.setHours(9, 0, 0, 0);
  return result;
}

export function extractTemporalAnchor(text: string): Date | null {
  const t = text.toLowerCase().slice(0, 500); // only check the first 500 chars
  const now = new Date();

  // "yesterday"
  if (/\byesterday\b/.test(t)) {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    d.setHours(9, 0, 0, 0);
    return d;
  }

  // "N days ago" / "N day ago" / "N days back"
  const daysAgo = t.match(/\b(\d+)\s+days?\s+(?:ago|back)\b/);
  if (daysAgo) {
    const d = new Date(now);
    d.setDate(d.getDate() - parseInt(daysAgo[1]));
    d.setHours(9, 0, 0, 0);
    return d;
  }

  // "N weeks ago" / "N weeks back"
  const weeksAgo = t.match(/\b(\d+)\s+weeks?\s+(?:ago|back)\b/);
  if (weeksAgo) {
    const d = new Date(now);
    d.setDate(d.getDate() - parseInt(weeksAgo[1]) * 7);
    d.setHours(9, 0, 0, 0);
    return d;
  }

  // "N months ago"
  const monthsAgo = t.match(/\b(\d+)\s+months?\s+(?:ago|back)\b/);
  if (monthsAgo) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - parseInt(monthsAgo[1]));
    d.setHours(9, 0, 0, 0);
    return d;
  }

  // "last monday" / "last friday" etc.
  const lastDay = t.match(/\blast\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|wed|thu|fri|sat)\b/);
  if (lastDay) {
    const dayNum = WEEKDAYS[lastDay[1]];
    if (dayNum !== undefined) return lastWeekday(dayNum, now);
  }

  // "this monday" / "this week monday" — could be before today this week
  const thisDay = t.match(/\bthis\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|wed|thu|fri|sat)\b/);
  if (thisDay) {
    const dayNum = WEEKDAYS[thisDay[1]];
    if (dayNum !== undefined) {
      const d = new Date(now);
      const diff = (dayNum - now.getDay() + 7) % 7;
      d.setDate(d.getDate() - (diff === 0 ? 0 : 7 - diff));
      d.setHours(9, 0, 0, 0);
      if (d <= now) return d;
    }
  }

  // "on january 15" / "on jan 15, 2024" / "march 5th"
  const namedDate = t.match(/\bon\s+([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/) ||
                    t.match(/\b([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/);
  if (namedDate) {
    const monthNum = MONTHS[namedDate[1]];
    if (monthNum) {
      const day = parseInt(namedDate[2]);
      const year = namedDate[3] ? parseInt(namedDate[3]) : now.getFullYear();
      const d = new Date(year, monthNum - 1, day, 9, 0, 0);
      // Only anchor to past dates
      if (d <= now && d.getFullYear() >= now.getFullYear() - 2) return d;
    }
  }

  // "a week ago" / "a month ago"
  if (/\ba\s+week\s+ago\b/.test(t)) {
    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    d.setHours(9, 0, 0, 0);
    return d;
  }
  if (/\ba\s+month\s+ago\b/.test(t)) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - 1);
    d.setHours(9, 0, 0, 0);
    return d;
  }

  return null;
}
