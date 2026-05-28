import type { SQLiteDatabase } from 'expo-sqlite';
import type { PrivacyLevel } from '../types/extraction';

export interface FollowUpRow {
  id: number;
  created_at: string;
  capture_id: number | null;
  assignee: string;
  action: string;
  status: 'pending' | 'done';
  privacy_level: PrivacyLevel;
  resolved_at: string | null;
}

export async function insertFollowUp(
  db: SQLiteDatabase,
  captureId: number,
  assignee: string,
  action: string,
  privacyLevel: PrivacyLevel,
): Promise<void> {
  await db.runAsync(
    'INSERT INTO follow_ups (capture_id, assignee, action, privacy_level) VALUES (?, ?, ?, ?)',
    captureId,
    assignee,
    action,
    privacyLevel,
  );
}

export async function listFollowUps(db: SQLiteDatabase): Promise<FollowUpRow[]> {
  return db.getAllAsync<FollowUpRow>(
    "SELECT * FROM follow_ups WHERE status = 'pending' ORDER BY created_at DESC, id DESC",
  );
}

export async function resolveFollowUp(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync(
    "UPDATE follow_ups SET status = 'done', resolved_at = CURRENT_TIMESTAMP WHERE id = ?",
    id,
  );
}

export async function countFollowUps(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM follow_ups WHERE status = 'pending'");
  return row?.n ?? 0;
}
