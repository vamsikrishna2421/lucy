import type { SQLiteDatabase } from 'expo-sqlite';
import type { ExtractedTask, PrivacyLevel } from '../types/extraction';

export interface TodoRow extends ExtractedTask {
  id: number;
  created_at: string;
  capture_id: number;
  privacy_level: PrivacyLevel;
  status: string;
  archived_at?: string | null;
  archive_reason?: string | null;
  /** Persistent list assignment (set by user or LUCY). NULL = auto-categorized. */
  list_name?: string | null;
}

export async function insertTodo(
  db: SQLiteDatabase,
  captureId: number,
  todo: ExtractedTask,
  privacy: PrivacyLevel,
): Promise<void> {
  await db.runAsync(
    'INSERT INTO todos (capture_id, task, category, urgency, context, privacy_level) VALUES (?, ?, ?, ?, ?, ?)',
    captureId,
    todo.task,
    todo.category,
    todo.urgency,
    todo.context,
    privacy,
  );
}

export async function listTodos(db: SQLiteDatabase): Promise<TodoRow[]> {
  return db.getAllAsync<TodoRow>('SELECT * FROM todos ORDER BY created_at DESC, id DESC');
}

export async function listPendingTodos(db: SQLiteDatabase): Promise<TodoRow[]> {
  return db.getAllAsync<TodoRow>(
    "SELECT * FROM todos WHERE status = 'pending' ORDER BY urgency = 'high' DESC, created_at DESC, id DESC",
  );
}

export async function findPendingPaymentTodo(
  db: SQLiteDatabase,
  followUpCreatedAt: string,
): Promise<TodoRow | null> {
  return db.getFirstAsync<TodoRow>(
    `SELECT * FROM todos
     WHERE status = 'pending'
       AND created_at <= ?
       AND created_at >= datetime(?, '-2 hours')
       AND (
         category = 'expense'
         OR task LIKE '%pay%'
         OR task LIKE '%payment%'
         OR task LIKE '%bill%'
         OR task LIKE '%rent%'
       )
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    followUpCreatedAt,
    followUpCreatedAt,
  );
}

export async function deleteTodo(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM todos WHERE id = ?', id);
}

export async function markTodoCompleted(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('UPDATE todos SET status = ? WHERE id = ?', 'completed', id);
}

export async function archiveTodo(db: SQLiteDatabase, id: number, reason: string): Promise<void> {
  await db.runAsync(
    'UPDATE todos SET status = ?, archived_at = CURRENT_TIMESTAMP, archive_reason = ? WHERE id = ?',
    'archived',
    reason,
    id,
  );
}

// ─── Interactive reorganization helpers (used by LUCY's Ask-chat actions) ──────────

/** Assigns a list/category to a set of todos (the "move tasks to a list" action). */
export async function recategorizeTodos(db: SQLiteDatabase, ids: number[], listName: string): Promise<number> {
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => '?').join(',');
  await db.runAsync(
    `UPDATE todos SET list_name = ? WHERE id IN (${placeholders}) AND status = 'pending'`,
    listName, ...ids,
  );
  return ids.length;
}

/** Renames a list everywhere it's used. */
export async function renameTodoList(db: SQLiteDatabase, from: string, to: string): Promise<void> {
  await db.runAsync('UPDATE todos SET list_name = ? WHERE list_name = ?', to, from);
}

/** Splits one combined todo into several atomic todos in the same list/category. */
export async function splitTodo(db: SQLiteDatabase, id: number, newTasks: string[]): Promise<void> {
  const original = await db.getFirstAsync<TodoRow>('SELECT * FROM todos WHERE id = ?', id);
  if (!original) return;
  for (const task of newTasks) {
    const t = task.trim();
    if (!t) continue;
    await db.runAsync(
      'INSERT INTO todos (capture_id, task, category, urgency, context, privacy_level, list_name) VALUES (?, ?, ?, ?, ?, ?, ?)',
      original.capture_id, t, original.category, original.urgency, original.context ?? '', original.privacy_level, original.list_name ?? null,
    );
  }
  await db.runAsync('DELETE FROM todos WHERE id = ?', id);
}

/** Permanently deletes a set of todos (duplicate cleanup). */
export async function deleteTodos(db: SQLiteDatabase, ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => '?').join(',');
  await db.runAsync(`DELETE FROM todos WHERE id IN (${placeholders})`, ...ids);
  return ids.length;
}

/** Archives a set of todos (stale cleanup, keeps them recoverable). */
export async function archiveTodos(db: SQLiteDatabase, ids: number[], reason: string): Promise<number> {
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => '?').join(',');
  await db.runAsync(
    `UPDATE todos SET status = 'archived', archived_at = CURRENT_TIMESTAMP, archive_reason = ? WHERE id IN (${placeholders})`,
    reason, ...ids,
  );
  return ids.length;
}

/**
 * Merge two duplicate todos: keep `keepId` (updating its task text if `mergedText` is
 * supplied), archive `discardId` as a duplicate.
 */
export async function mergeDuplicateTodos(
  db: SQLiteDatabase,
  keepId: number,
  discardId: number,
  mergedText?: string,
): Promise<void> {
  if (mergedText) {
    await db.runAsync('UPDATE todos SET task = ? WHERE id = ?', mergedText, keepId);
  }
  await archiveTodo(db, discardId, `merged into todo #${keepId}`);
}
