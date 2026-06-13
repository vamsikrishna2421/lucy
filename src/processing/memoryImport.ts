/**
 * Memory import — restores a buildMemoryExport() JSON onto a (typically new) device.
 * Inserts rows preserving original ids so relations (capture_id, etc.) stay intact, using
 * INSERT OR IGNORE so re-imports / unique constraints (learned_facts.normalized,
 * knowledge_entities) don't error. Best into a fresh install; merging into a populated DB
 * skips rows whose ids already exist.
 *
 * NOTE: vault images are NOT in the export (device-local files) — only vault metadata is
 * restored, so the document index comes back but the actual images must come over separately.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

const TABLE_MAP: Record<string, string> = {
  captures: 'captures', todos: 'todos', expenses: 'expenses', reminders: 'reminders',
  ideas: 'ideas', people: 'people', open_loops: 'open_loops', follow_ups: 'follow_ups',
  learned_profile: 'learned_facts', mood_entries: 'mood_entries', vault: 'vault_items',
};

async function tableColumns(db: SQLiteDatabase, table: string): Promise<Set<string>> {
  const rows = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  return new Set(rows.map((r) => r.name));
}

async function insertRows(db: SQLiteDatabase, table: string, rows: unknown): Promise<number> {
  if (!Array.isArray(rows) || !rows.length) return 0;
  const cols = await tableColumns(db, table);
  if (!cols.size) return 0; // table doesn't exist on this build
  let n = 0;
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const keys = Object.keys(row).filter((k) => cols.has(k)); // drop export-only fields (e.g. JOIN names)
    if (!keys.length) continue;
    try {
      await db.runAsync(
        `INSERT OR IGNORE INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`,
        ...keys.map((k) => row[k] as never),
      );
      n++;
    } catch { /* skip bad row */ }
  }
  return n;
}

export interface ImportResult { ok: boolean; counts: Record<string, number>; error?: string; }

export async function importMemoryExport(db: SQLiteDatabase, data: unknown): Promise<ImportResult> {
  if (!data || typeof data !== 'object') return { ok: false, counts: {}, error: 'Invalid export file' };
  const d = data as Record<string, unknown>;
  if (!d.version && !d.captures && !d.profile) return { ok: false, counts: {}, error: 'Not a LUCY memory export' };
  const counts: Record<string, number> = {};
  try {
    for (const [key, table] of Object.entries(TABLE_MAP)) {
      counts[table] = await insertRows(db, table, d[key]);
    }
    const k = d.knowledge as Record<string, unknown> | undefined;
    if (k) {
      counts.knowledge_entities = await insertRows(db, 'knowledge_entities', k.entities);
      counts.knowledge_connections = await insertRows(db, 'knowledge_connections', k.connections);
      counts.knowledge_insights = await insertRows(db, 'knowledge_insights', k.insights);
    }
    const p = d.profile as { name?: string; about?: string; languages?: string[] } | undefined;
    if (p) {
      const { setSetting } = await import('../db/settings');
      if (p.name) await setSetting(db, 'user_profile_name', String(p.name));
      if (p.about) await setSetting(db, 'user_profile_about', String(p.about));
      if (Array.isArray(p.languages)) await setSetting(db, 'user_profile_languages', JSON.stringify(p.languages));
    }
    return { ok: true, counts };
  } catch (e) {
    return { ok: false, counts, error: e instanceof Error ? e.message : 'Import failed' };
  }
}
