import type { SQLiteDatabase } from 'expo-sqlite';

export type ContextRequestStatus = 'open' | 'answered' | 'dismissed';
export type ContextRequestPriority = 'high' | 'medium' | 'low';

export interface ContextRequestRow {
  id: number;
  capture_id: number | null;
  created_at: string;
  question: string;
  snippet: string | null;
  reason: string | null;
  priority: ContextRequestPriority;
  status: ContextRequestStatus;
  answer_text: string | null;
  answered_at: string | null;
  privacy_level: 'private';
}

export async function insertContextRequest(
  db: SQLiteDatabase,
  captureId: number,
  snippet: string,
  question: string,
  reason: string,
  priority: ContextRequestPriority = 'medium',
): Promise<void> {
  const existing = await db.getFirstAsync<{ id: number }>(
    `SELECT id FROM context_requests
     WHERE capture_id = ? AND question = ? AND status = 'open'
     LIMIT 1`,
    captureId,
    question,
  );
  if (existing) {
    return;
  }
  await db.runAsync(
    `INSERT INTO context_requests (capture_id, snippet, question, reason, priority)
     VALUES (?, ?, ?, ?, ?)`,
    captureId,
    snippet,
    question,
    reason,
    priority,
  );
}

export async function listOpenContextRequests(db: SQLiteDatabase): Promise<ContextRequestRow[]> {
  return db.getAllAsync<ContextRequestRow>(
    `SELECT * FROM context_requests WHERE status = 'open'
     ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
     created_at DESC, id DESC`,
  );
}

export async function listAnsweredContextRequests(db: SQLiteDatabase): Promise<ContextRequestRow[]> {
  return db.getAllAsync<ContextRequestRow>(
    `SELECT * FROM context_requests WHERE status = 'answered'
     ORDER BY answered_at DESC, id DESC`,
  );
}

export async function answerContextRequest(
  db: SQLiteDatabase,
  id: number,
  answer: string,
): Promise<void> {
  await db.runAsync(
    `UPDATE context_requests SET status = 'answered', answer_text = ?, answered_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status = 'open'`,
    answer.trim(),
    id,
  );
}

export async function dismissContextRequest(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync(
    `UPDATE context_requests SET status = 'dismissed', answered_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status = 'open'`,
    id,
  );
}

export async function countOpenContextRequests(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM context_requests WHERE status = 'open'`,
  );
  return row?.n ?? 0;
}
