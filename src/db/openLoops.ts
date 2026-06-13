import type { SQLiteDatabase } from 'expo-sqlite';
import type { PrivacyLevel } from '../types/extraction';

export interface OpenLoopRow {
  id: number;
  created_at: string;
  capture_id: number | null;
  description: string;
  status: 'open' | 'resolved';
  privacy_level: PrivacyLevel;
  resolved_at: string | null;
}

export async function insertOpenLoop(
  db: SQLiteDatabase,
  captureId: number,
  description: string,
  privacyLevel: PrivacyLevel,
): Promise<void> {
  await db.runAsync(
    'INSERT INTO open_loops (capture_id, description, privacy_level) VALUES (?, ?, ?)',
    captureId,
    description,
    privacyLevel,
  );
}

export async function listOpenLoops(db: SQLiteDatabase): Promise<OpenLoopRow[]> {
  return db.getAllAsync<OpenLoopRow>(
    "SELECT * FROM open_loops WHERE status = 'open' ORDER BY created_at DESC, id DESC",
  );
}

export async function resolveOpenLoop(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync(
    "UPDATE open_loops SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP WHERE id = ?",
    id,
  );
}

/** Auto-resolve open loops that have gone stale (unresolved past `days`). Stops the
 *  "unfinished threads" list from accumulating forever (it had grown to 200+). */
export async function decayStaleOpenLoops(db: SQLiteDatabase, days = 30): Promise<number> {
  const res = await db.runAsync(
    `UPDATE open_loops SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP
     WHERE status = 'open' AND created_at < datetime('now', ?)`,
    `-${days} days`,
  );
  return res.changes ?? 0;
}

export async function countOpenLoops(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM open_loops WHERE status = 'open'");
  return row?.n ?? 0;
}
