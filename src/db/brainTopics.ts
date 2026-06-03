import type { SQLiteDatabase } from 'expo-sqlite';

export interface BrainTopicRow {
  id: number;
  parent_id: number | null;
  depth: number;
  path: string;
  name: string;
  emoji: string | null;
  description: string | null;
  color_hint: string | null;
  is_misc: number;
  is_archived: number;
  item_count: number;
  created_at: string;
  updated_at: string;
}

export interface TopicItemRow {
  id: number;
  topic_id: number;
  table_name: string;
  row_id: number;
  confidence: number;
  classified_by: string;
  created_at: string;
}

// ─── Topic CRUD ───────────────────────────────────────────────────────────────

/** Insert a topic node and calculate its materialized path.
 *  path format: "parentId/newId/" — enables fast subtree queries via LIKE. */
export async function insertTopic(
  db: SQLiteDatabase,
  name: string,
  parentId: number | null,
  emoji?: string | null,
  colorHint?: string | null,
): Promise<number> {
  const parent = parentId
    ? await db.getFirstAsync<{ path: string; depth: number }>(
        'SELECT path, depth FROM brain_topics WHERE id = ?', parentId)
    : null;
  const depth = parent ? parent.depth + 1 : 0;
  const result = await db.runAsync(
    `INSERT INTO brain_topics (parent_id, depth, path, name, emoji, color_hint) VALUES (?, ?, '', ?, ?, ?)`,
    parentId ?? null, depth, name, emoji ?? null, colorHint ?? null,
  );
  const newId = result.lastInsertRowId;
  const newPath = parent ? `${parent.path}${newId}/` : `${newId}/`;
  await db.runAsync('UPDATE brain_topics SET path = ? WHERE id = ?', newPath, newId);
  return newId;
}

export async function renameTopic(db: SQLiteDatabase, id: number, name: string): Promise<void> {
  await db.runAsync(
    'UPDATE brain_topics SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', name, id,
  );
}

export async function archiveTopic(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync(
    'UPDATE brain_topics SET is_archived = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?', id,
  );
}

/** Returns all non-archived topics sorted by path (natural tree order). */
export async function listTopics(db: SQLiteDatabase): Promise<BrainTopicRow[]> {
  return db.getAllAsync<BrainTopicRow>(
    'SELECT * FROM brain_topics WHERE is_archived = 0 ORDER BY path ASC',
  );
}

export async function listChildTopics(db: SQLiteDatabase, parentId: number | null): Promise<BrainTopicRow[]> {
  if (parentId === null) {
    return db.getAllAsync<BrainTopicRow>(
      'SELECT * FROM brain_topics WHERE parent_id IS NULL AND is_archived = 0 ORDER BY name ASC',
    );
  }
  return db.getAllAsync<BrainTopicRow>(
    'SELECT * FROM brain_topics WHERE parent_id = ? AND is_archived = 0 ORDER BY name ASC', parentId,
  );
}

export async function listSubtreeTopics(db: SQLiteDatabase, topicId: number): Promise<BrainTopicRow[]> {
  const root = await db.getFirstAsync<{ path: string }>('SELECT path FROM brain_topics WHERE id = ?', topicId);
  if (!root) return [];
  return db.getAllAsync<BrainTopicRow>(
    `SELECT * FROM brain_topics WHERE (path LIKE ? OR id = ?) AND is_archived = 0 ORDER BY path ASC`,
    `${root.path}%`, topicId,
  );
}

export async function getMiscTopic(db: SQLiteDatabase): Promise<BrainTopicRow | null> {
  return db.getFirstAsync<BrainTopicRow>('SELECT * FROM brain_topics WHERE is_misc = 1 LIMIT 1');
}

export async function ensureMiscTopic(db: SQLiteDatabase): Promise<number> {
  const existing = await getMiscTopic(db);
  if (existing) return existing.id;
  const id = await insertTopic(db, 'Misc', null, '📥');
  await db.runAsync('UPDATE brain_topics SET is_misc = 1 WHERE id = ?', id);
  return id;
}

// ─── Topic item linking ───────────────────────────────────────────────────────

export async function insertTopicItem(
  db: SQLiteDatabase,
  topicId: number,
  tableName: string,
  rowId: number,
  confidence = 1.0,
  classifiedBy: 'user' | 'llm' | 'seed' | 'migration' = 'llm',
): Promise<void> {
  await db.runAsync(
    `INSERT OR IGNORE INTO topic_items (topic_id, table_name, row_id, confidence, classified_by)
     VALUES (?, ?, ?, ?, ?)`,
    topicId, tableName, rowId, confidence, classifiedBy,
  );
  await db.runAsync(
    'UPDATE brain_topics SET item_count = item_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    topicId,
  );
}

export async function removeTopicItem(db: SQLiteDatabase, tableName: string, rowId: number): Promise<void> {
  const rows = await db.getAllAsync<{ topic_id: number }>(
    'SELECT topic_id FROM topic_items WHERE table_name = ? AND row_id = ?', tableName, rowId,
  );
  await db.runAsync('DELETE FROM topic_items WHERE table_name = ? AND row_id = ?', tableName, rowId);
  for (const r of rows) {
    await db.runAsync(
      'UPDATE brain_topics SET item_count = MAX(0, item_count - 1), updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      r.topic_id,
    );
  }
}

export async function moveTopicItem(
  db: SQLiteDatabase,
  tableName: string,
  rowId: number,
  newTopicId: number,
): Promise<void> {
  // Remove from all current topics, then place in new one
  await removeTopicItem(db, tableName, rowId);
  await insertTopicItem(db, newTopicId, tableName, rowId, 1.0, 'user');
}

export async function getTopicForItem(
  db: SQLiteDatabase,
  tableName: string,
  rowId: number,
): Promise<BrainTopicRow | null> {
  const ti = await db.getFirstAsync<{ topic_id: number }>(
    'SELECT topic_id FROM topic_items WHERE table_name = ? AND row_id = ? ORDER BY created_at DESC LIMIT 1',
    tableName, rowId,
  );
  if (!ti) return null;
  return db.getFirstAsync<BrainTopicRow>('SELECT * FROM brain_topics WHERE id = ?', ti.topic_id);
}

/** All items under a topic (including sub-topics via path). */
export async function listItemsInSubtree(
  db: SQLiteDatabase,
  topicId: number,
  tableName?: string,
  limit = 50,
): Promise<TopicItemRow[]> {
  const root = await db.getFirstAsync<{ path: string }>('SELECT path FROM brain_topics WHERE id = ?', topicId);
  if (!root) return [];
  const tableClause = tableName ? 'AND ti.table_name = ?' : '';
  if (tableName) {
    return db.getAllAsync<TopicItemRow>(
      `SELECT ti.* FROM topic_items ti
       JOIN brain_topics bt ON bt.id = ti.topic_id
       WHERE (bt.path LIKE ? OR bt.id = ?) AND ti.table_name = ?
       ORDER BY ti.created_at DESC LIMIT ?`,
      `${root.path}%`, topicId, tableName, limit,
    );
  }
  return db.getAllAsync<TopicItemRow>(
    `SELECT ti.* FROM topic_items ti
     JOIN brain_topics bt ON bt.id = ti.topic_id
     WHERE (bt.path LIKE ? OR bt.id = ?)
     ORDER BY ti.created_at DESC LIMIT ?`,
    `${root.path}%`, topicId, limit,
  );
}

// ─── Seeding state ────────────────────────────────────────────────────────────

export async function hasBrainGalaxyBeenSeeded(db: SQLiteDatabase): Promise<boolean> {
  const row = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM topic_seeding_runs WHERE status = 'accepted'",
  );
  return Number(row?.n ?? 0) > 0;
}

export async function recordSeedingRun(
  db: SQLiteDatabase,
  captureCount: number,
  proposedJson: string,
  status: 'pending' | 'accepted' | 'rejected',
): Promise<number> {
  const result = await db.runAsync(
    'INSERT INTO topic_seeding_runs (capture_count, proposed_json, status) VALUES (?, ?, ?)',
    captureCount, proposedJson, status,
  );
  return result.lastInsertRowId;
}
