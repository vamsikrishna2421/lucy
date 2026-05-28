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
