import type { SQLiteDatabase } from 'expo-sqlite';

export interface BrainPulseRow {
  id: number;
  generated_at: string;
  category: 'pattern' | 'person' | 'mood' | 'connection' | 'overdue';
  headline: string;
  detail: string | null;
  source_capture_ids: string | null; // JSON array
  seen_at: string | null;
  dismissed_at: string | null;
  notified: number;
}

export async function insertBrainPulse(
  db: SQLiteDatabase,
  category: BrainPulseRow['category'],
  headline: string,
  detail?: string | null,
  sourceCaptureIds?: number[],
): Promise<number> {
  const result = await db.runAsync(
    `INSERT INTO brain_pulses (category, headline, detail, source_capture_ids) VALUES (?, ?, ?, ?)`,
    category,
    headline,
    detail ?? null,
    sourceCaptureIds ? JSON.stringify(sourceCaptureIds) : null,
  );
  return result.lastInsertRowId;
}

export async function listUnseenPulses(db: SQLiteDatabase): Promise<BrainPulseRow[]> {
  return db.getAllAsync<BrainPulseRow>(
    `SELECT * FROM brain_pulses WHERE dismissed_at IS NULL ORDER BY generated_at DESC LIMIT 10`,
  );
}

export async function countUnseenPulses(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM brain_pulses WHERE dismissed_at IS NULL AND seen_at IS NULL`,
  );
  return Number(row?.n ?? 0);
}

export async function markPulseSeen(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync(
    `UPDATE brain_pulses SET seen_at = CURRENT_TIMESTAMP WHERE id = ? AND seen_at IS NULL`,
    id,
  );
}

export async function dismissPulse(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync(
    `UPDATE brain_pulses SET dismissed_at = CURRENT_TIMESTAMP WHERE id = ?`,
    id,
  );
}

export async function listDismissedPulses(db: SQLiteDatabase): Promise<BrainPulseRow[]> {
  return db.getAllAsync<BrainPulseRow>(
    `SELECT * FROM brain_pulses WHERE dismissed_at IS NOT NULL ORDER BY generated_at DESC LIMIT 20`,
  );
}

export async function pruneOldPulses(db: SQLiteDatabase): Promise<void> {
  // Keep only the last 48 hours of dismissed pulses; keep all non-dismissed.
  await db.runAsync(
    `DELETE FROM brain_pulses WHERE dismissed_at IS NOT NULL AND dismissed_at < datetime('now', '-48 hours')`,
  );
}
