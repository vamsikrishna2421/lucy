/** Projects — a dedicated space per personal project (Workspace → Projects). */
import type { SQLiteDatabase } from 'expo-sqlite';

export interface ProjectRow {
  id: number;
  created_at: string;
  name: string;
  description: string | null;
  color: string | null;
  status: string;
  /** JSON array of alternate names this project has absorbed (merged suggestions). */
  aliases: string | null;
}

/** Parse a project row's aliases JSON into a string[] (empty on null/garbage). */
export function projectAliases(row: Pick<ProjectRow, 'aliases'>): string[] {
  if (!row.aliases) return [];
  try {
    const v = JSON.parse(row.aliases);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : [];
  } catch { return []; }
}

export async function listProjects(db: SQLiteDatabase): Promise<ProjectRow[]> {
  return db.getAllAsync<ProjectRow>("SELECT * FROM projects WHERE status != 'archived' ORDER BY created_at DESC");
}

export async function createProject(db: SQLiteDatabase, name: string, description?: string | null): Promise<number> {
  const res = await db.runAsync(
    'INSERT INTO projects (name, description) VALUES (?, ?)', name.trim(), (description ?? '').trim() || null,
  );
  return res.lastInsertRowId;
}

export async function deleteProject(db: SQLiteDatabase, id: number): Promise<boolean> {
  const res = await db.runAsync('DELETE FROM projects WHERE id = ?', id);
  return res.changes > 0;
}

export async function updateProject(db: SQLiteDatabase, id: number, fields: { name?: string; description?: string | null }): Promise<void> {
  if (typeof fields.name === 'string') await db.runAsync('UPDATE projects SET name = ? WHERE id = ?', fields.name.trim(), id);
  if (fields.description !== undefined) await db.runAsync('UPDATE projects SET description = ? WHERE id = ?', (fields.description ?? '').trim() || null, id);
}

/** Rename a project (and optionally reset its description), preserving the OLD name as an alias so tasks
 *  and calendar blocks that still mention the long original name keep gathering under it. Non-destructive. */
export async function renameProject(db: SQLiteDatabase, id: number, name: string, description?: string | null): Promise<void> {
  const clean = (name ?? '').trim();
  if (!clean) return;
  const row = await db.getFirstAsync<ProjectRow>('SELECT * FROM projects WHERE id = ?', id);
  if (!row) return;
  const oldName = (row.name ?? '').trim();
  await updateProject(db, id, { name: clean, description: description === undefined ? row.description : description });
  if (oldName && oldName.toLowerCase() !== clean.toLowerCase()) {
    await addProjectAlias(db, id, oldName);
  }
}

/** Merge a suggested cluster into an existing project by recording its name as an alias — so the
 *  project's gather/count absorbs it, non-destructively and reversibly (no captures are moved). */
export async function addProjectAlias(db: SQLiteDatabase, projectId: number, alias: string): Promise<void> {
  const clean = (alias ?? '').trim();
  if (!clean) return;
  const row = await db.getFirstAsync<ProjectRow>('SELECT * FROM projects WHERE id = ?', projectId);
  if (!row) return;
  const list = projectAliases(row);
  const norm = (s: string) => s.toLowerCase().trim();
  if (norm(row.name) === norm(clean) || list.some((a) => norm(a) === norm(clean))) return; // already covered
  list.push(clean);
  await db.runAsync('UPDATE projects SET aliases = ? WHERE id = ?', JSON.stringify(list), projectId);
}

/** All the terms a project gathers by: its name plus any merged aliases. */
async function projectMatchTerms(db: SQLiteDatabase, name: string): Promise<string[]> {
  const row = await db.getFirstAsync<ProjectRow>('SELECT * FROM projects WHERE name = ?', name);
  const terms = [name, ...(row ? projectAliases(row) : [])];
  return [...new Set(terms.map((t) => t.trim()).filter(Boolean))];
}

/** Counts of items linked to a project by name match (lightweight v1 — tasks + scheduled blocks
 *  whose text mentions the project OR any of its merged aliases), so each project shows live activity. */
export async function projectActivity(db: SQLiteDatabase, name: string): Promise<{ tasks: number; blocks: number }> {
  const terms = await projectMatchTerms(db, name);
  const todoWhere = terms.map(() => '(task LIKE ? OR context LIKE ?)').join(' OR ');
  const todoArgs = terms.flatMap((term) => [`%${term}%`, `%${term}%`]);
  const blockWhere = terms.map(() => 'title LIKE ?').join(' OR ');
  const blockArgs = terms.map((term) => `%${term}%`);
  const t = await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) n FROM todos WHERE status='pending' AND (${todoWhere})`, ...todoArgs);
  const b = await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) n FROM scheduled_blocks WHERE status='committed' AND (${blockWhere})`, ...blockArgs);
  return { tasks: t?.n ?? 0, blocks: b?.n ?? 0 };
}
