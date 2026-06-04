import type { SQLiteDatabase } from 'expo-sqlite';

export interface DevLogRow {
  id: number;
  created_at: string;
  category: string;     // 'extraction' | 'ask' | 'whisper' | 'meeting' | 'classify' | 'error'
  model: string;
  input_preview: string;
  output_preview: string;
  duration_ms: number;
  error: string | null;
}

export async function insertDevLog(
  db: SQLiteDatabase,
  row: Omit<DevLogRow, 'id' | 'created_at'>,
): Promise<void> {
  try {
    await db.runAsync(
      `INSERT INTO dev_log (category, model, input_preview, output_preview, duration_ms, error)
       VALUES (?, ?, ?, ?, ?, ?)`,
      row.category, row.model,
      row.input_preview.slice(0, 600),
      row.output_preview.slice(0, 600),
      row.duration_ms,
      row.error ?? null,
    );
    // Keep last 500 rows only
    await db.runAsync(
      `DELETE FROM dev_log WHERE id NOT IN (SELECT id FROM dev_log ORDER BY id DESC LIMIT 500)`,
    );
  } catch { /* non-critical */ }
}

export async function listDevLogs(db: SQLiteDatabase, limit = 100): Promise<DevLogRow[]> {
  return db.getAllAsync<DevLogRow>(
    `SELECT * FROM dev_log ORDER BY id DESC LIMIT ?`, limit,
  );
}

export async function clearDevLogs(db: SQLiteDatabase): Promise<void> {
  await db.runAsync('DELETE FROM dev_log');
}
