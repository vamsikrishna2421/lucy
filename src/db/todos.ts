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

// ── Task QA: meta/dev tasks must never enter the user's personal list ──
// Building/designing LUCY itself, "add to backlog", list-merge, dedup-notes = not the user's todos.
const META_TASK_RE = /\b(build|implement|design|prototype|wire up|ship|code|spec out)\b[^.]{0,40}\b(feature|wake word|voice trigger|ui\b|layout|spec\b|enforcement|intelligence layer|timetable feature|engine|endpoint|\bapi\b|backlog)\b/i;
const META_TASK_RE2 = /\bto the lucy app\b|\blucy app backlog\b|\badd\b[^.]{0,30}\bbacklog\b|\bmerge\b[^.]{0,30}\blist\b|\bremove duplicate\b[^.]{0,30}(note|reminder)|\bfeature spec\b/i;
export function looksLikeMetaTask(task: string): boolean {
  const t = (task || '').toLowerCase();
  return META_TASK_RE.test(t) || META_TASK_RE2.test(t);
}

const CAT_RULES: Array<[RegExp, string]> = [
  [/\b(grocery|groceries|supermarket|milk|eggs|vegetables|patel brothers)\b/i, 'groceries'],
  [/\b(buy|purchase|pick up|order|return|drop off|shop)\b/i, 'errand'],
  [/\b(pay|bill|rent|invoice|insurance|bank|tax|transfer|refund)\b/i, 'finance'],
  [/\b(gym|workout|run|walk|doctor|dentist|medicine|appointment|health)\b/i, 'health'],
  [/\b(call|email|message|text|reply|meet|meeting|reach out|follow up)\b/i, 'work'],
  [/\b(clean|fix|repair|laundry|cook|home|house|garden|move)\b/i, 'home'],
  [/\b(learn|study|read|research|course|practice|look into)\b/i, 'learning'],
];
/** Infer a better category when the LLM left it generic. */
export function categorizeTask(task: string, category: string | null | undefined): string {
  const c = (category || '').trim().toLowerCase();
  if (c && !['other', 'others', 'misc', 'general', 'uncategorized', ''].includes(c)) return c;
  for (const [re, cat] of CAT_RULES) if (re.test(task || '')) return cat;
  return c || 'other';
}

/** Archive meta/dev tasks that slipped into the user's pending list. Returns count archived. */
export async function cleanupJunkTodos(db: SQLiteDatabase): Promise<number> {
  const rows = await db.getAllAsync<{ id: number; task: string }>("SELECT id, task FROM todos WHERE status = 'pending' AND archived_at IS NULL");
  let n = 0;
  for (const r of rows) {
    if (looksLikeMetaTask(r.task)) {
      await db.runAsync("UPDATE todos SET status = 'archived', archived_at = CURRENT_TIMESTAMP, archive_reason = 'meta/dev task (QA)' WHERE id = ?", r.id);
      n++;
    }
  }
  return n;
}

/** Backfill better categories on existing pending todos sitting in a generic bucket. */
export async function recategorizeAllTodos(db: SQLiteDatabase): Promise<number> {
  const rows = await db.getAllAsync<{ id: number; task: string; category: string | null }>("SELECT id, task, category FROM todos WHERE status = 'pending' AND archived_at IS NULL");
  let n = 0;
  for (const r of rows) {
    const next = categorizeTask(r.task, r.category);
    if (next !== (r.category || '').toLowerCase()) { await db.runAsync('UPDATE todos SET category = ? WHERE id = ?', next, r.id); n++; }
  }
  return n;
}

export async function insertTodo(
  db: SQLiteDatabase,
  captureId: number,
  todo: ExtractedTask,
  privacy: PrivacyLevel,
): Promise<void> {
  // Meta/app-dev tasks shouldn't clutter the active board — but DON'T silently discard them (that
  // permanently loses a task the user may actually want, e.g. "design the kitchen layout"). Insert
  // them pre-archived with a reason so they're recoverable from the archive instead of vanishing.
  const isMeta = looksLikeMetaTask(todo.task);
  await db.runAsync(
    `INSERT INTO todos (capture_id, task, category, urgency, context, privacy_level, archived_at, archive_reason)
     VALUES (?, ?, ?, ?, ?, ?, ${isMeta ? 'CURRENT_TIMESTAMP' : 'NULL'}, ?)`,
    captureId,
    todo.task,
    categorizeTask(todo.task, todo.category),
    todo.urgency,
    todo.context,
    privacy,
    isMeta ? 'auto-archived: looked like an app/meta task' : null,
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

export async function deleteTodo(db: SQLiteDatabase, id: number): Promise<boolean> {
  const res = await db.runAsync('DELETE FROM todos WHERE id = ?', id);
  return res.changes > 0;
}

export async function markTodoCompleted(db: SQLiteDatabase, id: number): Promise<boolean> {
  const res = await db.runAsync('UPDATE todos SET status = ? WHERE id = ?', 'completed', id);
  return res.changes > 0;
}

export async function archiveTodo(db: SQLiteDatabase, id: number, reason: string): Promise<boolean> {
  const res = await db.runAsync(
    "UPDATE todos SET status = ?, archived_at = CURRENT_TIMESTAMP, archive_reason = ? WHERE id = ? AND status != 'archived'",
    'archived',
    reason,
    id,
  );
  return res.changes > 0;
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
