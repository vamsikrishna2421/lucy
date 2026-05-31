/**
 * Journal splitter — detects dated sections in a single capture and splits
 * them into separate captures with the correct historical timestamps.
 *
 * Handles formats:
 *   "January 15, 2024" / "Jan 15, 2024"
 *   "2024-01-15" / "01/15/2024"
 *   "Day 1 - March 3" / "March 3rd"
 *   "## March 3" / "### Day 45"
 */

import type { SQLiteDatabase } from 'expo-sqlite';

const MONTHS: Record<string, number> = {
  january:1, jan:1, february:2, feb:2, march:3, mar:3, april:4, apr:4,
  may:5, june:6, jun:6, july:7, jul:7, august:8, aug:8,
  september:9, sep:9, sept:9, october:10, oct:10, november:11, nov:11, december:12, dec:12,
};

const DATE_PATTERNS = [
  // "January 15, 2024" or "January 15 2024"
  /^(?:#+\s*)?(?:day\s+\d+\s*[-–]\s*)?([a-zA-Z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})/i,
  // "2024-01-15"
  /^(?:#+\s*)?(\d{4})-(\d{2})-(\d{2})/,
  // "01/15/2024"
  /^(?:#+\s*)?(\d{1,2})\/(\d{1,2})\/(\d{4})/,
  // "Day 45 (some month context)" — approximate, use today - n days
  /^(?:#+\s*)?day\s+(\d+)(?:\s|$)/i,
];

interface JournalSection {
  date: Date;
  text: string;
}

function parseDate(line: string): Date | null {
  // "Month Day, Year"
  const m1 = line.match(/^(?:#+\s*)?(?:day\s+\d+\s*[-–]\s*)?([a-zA-Z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})/i);
  if (m1) {
    const month = MONTHS[m1[1].toLowerCase()];
    if (month) return new Date(parseInt(m1[3]), month - 1, parseInt(m1[2]), 9, 0, 0);
  }
  // "YYYY-MM-DD"
  const m2 = line.match(/^(?:#+\s*)?(\d{4})-(\d{2})-(\d{2})/);
  if (m2) return new Date(parseInt(m2[1]), parseInt(m2[2]) - 1, parseInt(m2[3]), 9, 0, 0);
  // "MM/DD/YYYY"
  const m3 = line.match(/^(?:#+\s*)?(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m3) return new Date(parseInt(m3[3]), parseInt(m3[1]) - 1, parseInt(m3[2]), 9, 0, 0);
  // "Day N" → N days ago from today
  const m4 = line.match(/^(?:#+\s*)?day\s+(\d+)(?:\s|$)/i);
  if (m4) {
    const n = parseInt(m4[1]);
    const d = new Date();
    d.setDate(d.getDate() - (n - 1));
    d.setHours(9, 0, 0, 0);
    return d;
  }
  return null;
}

export function splitJournal(text: string): JournalSection[] {
  const lines = text.split('\n');
  const sections: JournalSection[] = [];
  let currentDate: Date | null = null;
  let currentLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const parsedDate = trimmed.length > 3 ? parseDate(trimmed) : null;

    if (parsedDate && parsedDate.getFullYear() >= 2000 && parsedDate.getFullYear() <= 2100) {
      // Save previous section
      if (currentDate && currentLines.some((l) => l.trim())) {
        sections.push({ date: currentDate, text: currentLines.join('\n').trim() });
      }
      currentDate = parsedDate;
      currentLines = [line]; // include the date line as context
    } else {
      currentLines.push(line);
    }
  }

  // Push final section
  if (currentDate && currentLines.some((l) => l.trim())) {
    sections.push({ date: currentDate, text: currentLines.join('\n').trim() });
  }

  return sections;
}

/** Returns true if text looks like a multi-date journal (3+ dated sections) */
export function isMultiDateJournal(text: string): boolean {
  return splitJournal(text).length >= 3;
}

/** Insert each dated section as a separate capture with correct timestamp */
export async function ingestJournal(
  db: SQLiteDatabase,
  text: string,
  privacyLevel: 'private' | 'local' | 'normal',
  originId?: number,
): Promise<number> {
  const sections = splitJournal(text);
  if (sections.length < 3) return 0;

  const { insertCapture } = await import('../db/captures');
  const total = sections.length;

  for (let i = 0; i < total; i++) {
    const section = sections[i];
    const dateLabel = section.date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const position = i === 0 ? 'START' : i === total - 1 ? 'END' : `MIDDLE (${i + 1}/${total})`;

    // Prepend chunk context so LLM knows this is day N of a multi-day journal
    const labeledText =
      `[JOURNAL ENTRY ${i + 1} OF ${total} — ${position}]\n` +
      `[Date: ${dateLabel} — extract only events/tasks from this specific date]\n\n` +
      section.text;

    const id = await insertCapture(db, 'text', labeledText, privacyLevel, false);
    // Tag with the origin so a later reprocess can replace (not duplicate) these splits.
    await db.runAsync(
      'UPDATE captures SET created_at = ?, split_origin_id = ? WHERE id = ?',
      section.date.toISOString(),
      originId ?? null,
      id,
    );
  }

  return total;
}
