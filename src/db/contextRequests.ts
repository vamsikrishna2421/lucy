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
  // Joined from the source capture so the question is self-explanatory (the user couldn't recall a
  // memory from a 3-4 word snippet). Nullable when the capture was deleted.
  source_created_at?: string | null;
  source_title?: string | null;
  source_excerpt?: string | null;
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
    `SELECT cr.*,
            c.created_at      AS source_created_at,
            c.extracted_title AS source_title,
            substr(c.raw_transcript, 1, 280) AS source_excerpt
     FROM context_requests cr
     LEFT JOIN captures c ON c.id = cr.capture_id
     WHERE cr.status = 'open'
     ORDER BY CASE cr.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
     cr.created_at DESC, cr.id DESC`,
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
