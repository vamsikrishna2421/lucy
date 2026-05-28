import type { SQLiteDatabase } from 'expo-sqlite';
import type { LucyAnswer } from '../processing/ask';

export interface AskThreadRow {
  id: number;
  created_at: string;
  updated_at: string;
  title: string;
}

export interface AskThreadSummaryRow extends AskThreadRow {
  first_question: string;
  message_count: number;
}

export interface AskMessageRow {
  id: number;
  thread_id: number;
  created_at: string;
  role: 'user' | 'lucy';
  text: string | null;
  answer_json: string | null;
}

export async function getActiveAskThread(db: SQLiteDatabase): Promise<AskThreadRow | null> {
  return db.getFirstAsync<AskThreadRow>(
    'SELECT * FROM ask_threads WHERE archived = 0 ORDER BY updated_at DESC, id DESC LIMIT 1',
  );
}

export async function createAskThread(db: SQLiteDatabase, title = 'Memory conversation'): Promise<AskThreadRow> {
  const result = await db.runAsync(
    'INSERT INTO ask_threads (title) VALUES (?)',
    title,
  );
  return (await db.getFirstAsync<AskThreadRow>(
    'SELECT * FROM ask_threads WHERE id = ?',
    result.lastInsertRowId,
  )) as AskThreadRow;
}

export async function getOrCreateActiveAskThread(db: SQLiteDatabase): Promise<AskThreadRow> {
  return (await getActiveAskThread(db)) ?? createAskThread(db);
}

export async function listAskThreads(db: SQLiteDatabase): Promise<AskThreadSummaryRow[]> {
  return db.getAllAsync<AskThreadSummaryRow>(
    `SELECT t.id, t.created_at, t.updated_at, t.title,
       COALESCE((
         SELECT text FROM ask_messages
         WHERE thread_id = t.id AND role = 'user'
         ORDER BY created_at ASC, id ASC LIMIT 1
       ), t.title) AS first_question,
       (SELECT COUNT(*) FROM ask_messages WHERE thread_id = t.id) AS message_count
     FROM ask_threads t
     WHERE EXISTS (SELECT 1 FROM ask_messages WHERE thread_id = t.id)
     ORDER BY t.updated_at DESC, t.id DESC`,
  );
}

export async function listAskMessages(db: SQLiteDatabase, threadId: number): Promise<AskMessageRow[]> {
  return db.getAllAsync<AskMessageRow>(
    'SELECT * FROM ask_messages WHERE thread_id = ? ORDER BY created_at ASC, id ASC',
    threadId,
  );
}

export async function insertUserAskMessage(
  db: SQLiteDatabase,
  threadId: number,
  text: string,
): Promise<number> {
  const result = await db.runAsync(
    'INSERT INTO ask_messages (thread_id, role, text) VALUES (?, ?, ?)',
    threadId,
    'user',
    text,
  );
  await db.runAsync('UPDATE ask_threads SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', threadId);
  return result.lastInsertRowId;
}

export async function insertLucyAskMessage(
  db: SQLiteDatabase,
  threadId: number,
  answer: LucyAnswer,
): Promise<number> {
  const result = await db.runAsync(
    'INSERT INTO ask_messages (thread_id, role, answer_json) VALUES (?, ?, ?)',
    threadId,
    'lucy',
    JSON.stringify(answer),
  );
  await db.runAsync('UPDATE ask_threads SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', threadId);
  return result.lastInsertRowId;
}
