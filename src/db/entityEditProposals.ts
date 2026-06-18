/**
 * Entity-edit proposals — when a NEW capture clearly relates to an EXISTING Workspace project, LUCY
 * proposes filing/appending it (propose-and-confirm; never auto-mutates, per the note-merge lesson).
 * Surfaced as approval cards in the inbox; applying appends the note to the project's description.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

export interface EntityEditProposalRow {
  id: number;
  project_id: number;
  project_name: string | null;
  capture_id: number | null;
  op: string;
  suggested_text: string | null;
  status: string;
  created_at: string;
}

/** Create an append proposal, deduped so a project+capture pair never stacks twice. */
export async function proposeProjectAppend(
  db: SQLiteDatabase,
  projectId: number,
  projectName: string,
  captureId: number,
  suggestedText: string,
): Promise<void> {
  const text = (suggestedText || '').trim();
  if (!text) return;
  const dupe = await db.getFirstAsync<{ id: number }>(
    "SELECT id FROM entity_edit_proposals WHERE status='open' AND project_id=? AND capture_id=?",
    projectId, captureId,
  );
  if (dupe) return;
  await db.runAsync(
    "INSERT INTO entity_edit_proposals (project_id, project_name, capture_id, op, suggested_text) VALUES (?, ?, ?, 'append', ?)",
    projectId, projectName, captureId, text,
  );
}

export async function listOpenEntityEditProposals(db: SQLiteDatabase): Promise<EntityEditProposalRow[]> {
  return db.getAllAsync<EntityEditProposalRow>("SELECT * FROM entity_edit_proposals WHERE status='open' ORDER BY id DESC LIMIT 50");
}

export async function countOpenEntityEditProposals(db: SQLiteDatabase): Promise<number> {
  const r = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) n FROM entity_edit_proposals WHERE status='open'");
  return r?.n ?? 0;
}

export async function setEntityEditProposalStatus(db: SQLiteDatabase, id: number, status: 'applied' | 'dismissed'): Promise<void> {
  await db.runAsync('UPDATE entity_edit_proposals SET status=? WHERE id=?', status, id);
}

/** Apply: append the suggested text to the project's description (dated), then mark applied. */
export async function applyEntityEditProposal(db: SQLiteDatabase, id: number): Promise<boolean> {
  const p = await db.getFirstAsync<EntityEditProposalRow>('SELECT * FROM entity_edit_proposals WHERE id=?', id);
  if (!p) return false;
  const proj = await db.getFirstAsync<{ description: string | null }>('SELECT description FROM projects WHERE id=?', p.project_id);
  if (!proj) { await setEntityEditProposalStatus(db, id, 'dismissed'); return false; }
  const stamp = new Date().toLocaleDateString();
  const line = `• ${(p.suggested_text || '').trim()} (${stamp})`;
  const merged = `${proj.description ? `${proj.description}\n` : ''}${line}`.trim();
  await db.runAsync('UPDATE projects SET description=? WHERE id=?', merged, p.project_id);
  await setEntityEditProposalStatus(db, id, 'applied');
  return true;
}
