/**
 * LUCY "On This Day" — Retrospective Memory Surfacing
 *
 * Every day, LUCY checks if you captured anything on this same calendar
 * date in previous years and surfaces it as a meaningful retrospective.
 * Like a message from your past self.
 */

import type { SQLiteDatabase } from 'expo-sqlite';
import { getSetting, setSetting } from '../db/settings';
import { sendGuardianNotification } from './notifications';
import { parseDbDate } from '../utils/datetime';

export interface OnThisDayMemory {
  captureId: number;
  title: string;
  snippet: string;
  capturedAt: string;
  yearsAgo: number;
}

export async function getOnThisDayMemories(db: SQLiteDatabase): Promise<OnThisDayMemory[]> {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day   = String(now.getDate()).padStart(2, '0');
  const thisYear = now.getFullYear();

  const rows = await db.getAllAsync<{
    id: number;
    extracted_title: string | null;
    raw_transcript: string | null;
    created_at: string;
  }>(
    `SELECT id, extracted_title, raw_transcript, created_at
     FROM captures
     WHERE strftime('%m-%d', created_at) = ?
       AND strftime('%Y', created_at) < ?
       AND privacy_level != 'private'
       AND processed > 0
     ORDER BY created_at DESC
     LIMIT 5`,
    `${month}-${day}`,
    String(thisYear),
  );

  return rows.map((row) => {
    const captureYear = parseDbDate(row.created_at).getFullYear();
    return {
      captureId:  row.id,
      title:      row.extracted_title ?? 'A memory',
      snippet:    (row.raw_transcript ?? '').slice(0, 100) + (row.raw_transcript && row.raw_transcript.length > 100 ? '...' : ''),
      capturedAt: row.created_at,
      yearsAgo:   thisYear - captureYear,
    };
  });
}

const OTD_KEY = 'on_this_day_last_sent';

export async function sendOnThisDayIfDue(db: SQLiteDatabase): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const lastSent = await getSetting(db, OTD_KEY);
  if (lastSent === today) return;

  const memories = await getOnThisDayMemories(db);
  if (memories.length === 0) return;

  const first = memories[0];
  const yearLabel = first.yearsAgo === 1 ? '1 year ago' : `${first.yearsAgo} years ago`;
  const message = memories.length === 1
    ? `${yearLabel} you captured: "${first.title}"`
    : `${yearLabel}: "${first.title}" — and ${memories.length - 1} more memory from this day`;

  await sendGuardianNotification(message, {
    kind:       'on-this-day',
    memoryCount: memories.length,
    yearsAgo:   first.yearsAgo,
  });

  await setSetting(db, OTD_KEY, today);
}
