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

/** Returns true if a pending reminder with very similar text already exists */
export async function reminderAlreadyExists(db: SQLiteDatabase, text: string): Promise<boolean> {
  const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  const needle = normalise(text);
  const existing = await db.getAllAsync<{ text: string }>(
    "SELECT text FROM reminders WHERE status = 'pending' ORDER BY id DESC LIMIT 40",
  );
  for (const row of existing) {
    const haystack = normalise(row.text);
    if (haystack === needle) return true;
    // word-overlap ≥ 65 %
    const needleWords = new Set(needle.split(/\s+/).filter(Boolean));
    const haystackWords = haystack.split(/\s+/).filter(Boolean);
    if (needleWords.size === 0) continue;
    const overlap = haystackWords.filter((w) => needleWords.has(w)).length;
    if (overlap / needleWords.size >= 0.65) return true;
  }
  return false;
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
