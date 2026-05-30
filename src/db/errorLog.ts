import type { SQLiteDatabase } from 'expo-sqlite';
import { getDatabase } from './index';

export interface ErrorLogRow {
  id: number;
  occurred_at: string;
  context: string;
  message: string;
}

const MAX_ROWS = 100;

/**
 * Records an error to a bounded ring buffer so failures stop disappearing into
 * blanket `catch {}` blocks and become visible in Settings → Diagnostics.
 * Never throws — logging an error must not itself break the caller.
 */
export async function logError(context: string, error: unknown, db?: SQLiteDatabase): Promise<void> {
  try {
    const database = db ?? (await getDatabase());
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    await database.runAsync(
      'INSERT INTO error_log (context, message) VALUES (?, ?)',
      context,
      message.slice(0, 2000),
    );
    // Trim to the most recent MAX_ROWS.
    await database.runAsync(
      `DELETE FROM error_log WHERE id NOT IN (
         SELECT id FROM error_log ORDER BY id DESC LIMIT ?
       )`,
      MAX_ROWS,
    );
  } catch {
    // Diagnostics are best-effort; swallow.
  }
}

export async function listRecentErrors(db: SQLiteDatabase, limit = 20): Promise<ErrorLogRow[]> {
  return db.getAllAsync<ErrorLogRow>(
    'SELECT * FROM error_log ORDER BY occurred_at DESC, id DESC LIMIT ?',
    limit,
  );
}

export async function clearErrorLog(db: SQLiteDatabase): Promise<void> {
  await db.runAsync('DELETE FROM error_log');
}
