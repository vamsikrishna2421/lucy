import type { SQLiteDatabase } from 'expo-sqlite';
import type { ExtractedReminder, PrivacyLevel } from '../types/extraction';

export interface ReminderRow extends ExtractedReminder {
  id: number;
  created_at: string;
  remind_at: string | null;
  privacy_level: PrivacyLevel;
  status: string;
  notification_id: string | null;
  scheduled_at: string | null;
  archived_at?: string | null;
  archive_reason?: string | null;
}

/**
 * True only if the SAME reminder (same text AND same time) is already pending. A reminder with the
 * same text but a different time is NOT a duplicate — that's how "remind me on the 5th, 15th, 25th"
 * legitimately produces three reminders. (The old text-only 65%-overlap check wrongly collapsed
 * multi-date reminders into one and false-matched unrelated reminders, so extracted reminders
 * silently never persisted.)
 */
export async function reminderAlreadyExists(db: SQLiteDatabase, text: string, time?: string | null): Promise<boolean> {
  const normalise = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const needle = normalise(text);
  if (!needle) return false;
  const want = time ?? null;
  const existing = await db.getAllAsync<{ text: string; remind_at: string | null }>(
    "SELECT text, remind_at FROM reminders WHERE status = 'pending' ORDER BY id DESC LIMIT 80",
  );
  return existing.some((row) => normalise(row.text) === needle && (row.remind_at ?? null) === want);
}

export async function insertReminder(
  db: SQLiteDatabase,
  captureId: number,
  reminder: ExtractedReminder,
  privacy: PrivacyLevel,
): Promise<number> {
  const result = await db.runAsync(
    'INSERT INTO reminders (capture_id, text, remind_at, urgency, privacy_level) VALUES (?, ?, ?, ?, ?)',
    captureId,
    reminder.text,
    reminder.time,
    reminder.urgency,
    privacy,
  );
  return result.lastInsertRowId;
}

export async function markReminderScheduled(
  db: SQLiteDatabase,
  id: number,
  notificationId: string,
): Promise<void> {
  await db.runAsync(
    'UPDATE reminders SET notification_id = ?, scheduled_at = CURRENT_TIMESTAMP WHERE id = ?',
    notificationId,
    id,
  );
}

export async function listReminders(db: SQLiteDatabase): Promise<ReminderRow[]> {
  return db.getAllAsync<ReminderRow>(
    'SELECT *, remind_at as time FROM reminders WHERE status = ? ORDER BY remind_at IS NULL, remind_at ASC, id DESC',
    'pending',
  );
}

export async function archiveReminder(db: SQLiteDatabase, id: number, reason: string): Promise<void> {
  await db.runAsync(
    'UPDATE reminders SET status = ?, archived_at = CURRENT_TIMESTAMP, archive_reason = ? WHERE id = ?',
    'archived',
    reason,
    id,
  );
}
