import type { SQLiteDatabase } from 'expo-sqlite';
import type { ExtractedReminder, PrivacyLevel } from '../types/extraction';
import { asReminderRecurrence, nextFutureOccurrence, type ReminderRecurrence } from '../processing/reminderRecurrence';

export interface ReminderRow extends ExtractedReminder {
  id: number;
  created_at: string;
  remind_at: string | null;
  privacy_level: PrivacyLevel;
  status: string;
  notification_id: string | null;
  scheduled_at: string | null;
  recurrence: ReminderRecurrence | null;
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
  recurrence: ReminderRecurrence | null = null,
): Promise<number> {
  const result = await db.runAsync(
    'INSERT INTO reminders (capture_id, text, remind_at, urgency, privacy_level, recurrence) VALUES (?, ?, ?, ?, ?, ?)',
    captureId,
    reminder.text,
    reminder.time,
    reminder.urgency,
    privacy,
    recurrence,
  );
  return result.lastInsertRowId;
}

/**
 * Advance a recurring reminder to its next future occurrence after it fires / is acknowledged,
 * keeping it pending and clearing the old schedule so it gets re-scheduled. No-op (returns null)
 * for one-shot reminders. Returns the new remind_at as ms epoch when advanced.
 */
export async function advanceRecurringReminder(db: SQLiteDatabase, id: number, now = Date.now()): Promise<number | null> {
  const row = await db.getFirstAsync<{ remind_at: string | null; recurrence: string | null; status: string }>(
    'SELECT remind_at, recurrence, status FROM reminders WHERE id = ?',
    id,
  );
  if (!row) return null;
  const recurrence = asReminderRecurrence(row.recurrence);
  if (!recurrence || !row.remind_at) return null;
  const currentMs = new Date(row.remind_at.includes('T') ? row.remind_at : `${row.remind_at.replace(' ', 'T')}Z`).getTime();
  if (!Number.isFinite(currentMs)) return null;
  const next = nextFutureOccurrence(currentMs, recurrence, now);
  if (next === null) return null;
  await db.runAsync(
    "UPDATE reminders SET remind_at = ?, notification_id = NULL, scheduled_at = NULL, status = 'pending' WHERE id = ?",
    new Date(next).toISOString(),
    id,
  );
  return next;
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

/** Returns true only if a pending reminder with this id actually existed (for honest API responses). */
export async function archiveReminder(db: SQLiteDatabase, id: number, reason: string): Promise<boolean> {
  const res = await db.runAsync(
    "UPDATE reminders SET status = ?, archived_at = CURRENT_TIMESTAMP, archive_reason = ? WHERE id = ? AND status != 'archived'",
    'archived',
    reason,
    id,
  );
  return res.changes > 0;
}
