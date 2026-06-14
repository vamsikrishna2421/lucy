/** Projects — a dedicated space per personal project (Workspace → Projects). */
import type { SQLiteDatabase } from 'expo-sqlite';

export interface ProjectRow {
  id: number;
  created_at: string;
  name: string;
  description: string | null;
  color: string | null;
  status: string;
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

export async function deleteProject(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM projects WHERE id = ?', id);
}

export async function updateProject(db: SQLiteDatabase, id: number, fields: { name?: string; description?: string | null }): Promise<void> {
  if (typeof fields.name === 'string') await db.runAsync('UPDATE projects SET name = ? WHERE id = ?', fields.name.trim(), id);
  if (fields.description !== undefined) await db.runAsync('UPDATE projects SET description = ? WHERE id = ?', (fields.description ?? '').trim() || null, id);
}

/** Counts of items linked to a project by name match (lightweight v1 — tasks + scheduled blocks
 *  whose text mentions the project), so each project space shows live activity. */
export async function projectActivity(db: SQLiteDatabase, name: string): Promise<{ tasks: number; blocks: number }> {
  const like = `%${name}%`;
  const t = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) n FROM todos WHERE status='pending' AND (task LIKE ? OR context LIKE ?)", like, like);
  const b = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) n FROM scheduled_blocks WHERE status='committed' AND title LIKE ?", like);
  return { tasks: t?.n ?? 0, blocks: b?.n ?? 0 };
}
