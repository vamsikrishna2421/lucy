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
