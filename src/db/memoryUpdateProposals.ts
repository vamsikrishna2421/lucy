import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * Memory-update proposals — the "self-improving brain", SAFE mode.
 *
 * When a new capture looks like it corrects/enriches an EARLIER note, LUCY does NOT silently rewrite
 * the old memory (that risks corrupting the brain on a wrong judgment). Instead she records a
 * PROPOSAL here; the user taps Apply (which folds the context into the old note and re-extracts it)
 * or Dismiss. Nothing touches existing memory without an explicit tap.
 */
export type MemoryUpdateKind = 'correction' | 'enrichment';
export type MemoryUpdateStatus = 'open' | 'applied' | 'dismissed';

export interface MemoryUpdateProposalRow {
  id: number;
  created_at: string;
  new_capture_id: number;
  old_capture_id: number;
  kind: MemoryUpdateKind;
  summary: string;            // one-line, user-facing: what LUCY thinks changed
  suggested_context: string;  // the text to fold into the old note on Apply
  status: MemoryUpdateStatus;
  // joined for display
  new_excerpt?: string | null;
  old_excerpt?: string | null;
  old_title?: string | null;
  old_created_at?: string | null;
}

/** Insert a proposal unless an identical open one already exists for the same note pair. */
export async function insertMemoryUpdateProposal(
  db: SQLiteDatabase,
  newCaptureId: number,
  oldCaptureId: number,
  kind: MemoryUpdateKind,
  summary: string,
  suggestedContext: string,
): Promise<void> {
  if (newCaptureId === oldCaptureId) return;
  const existing = await db.getFirstAsync<{ id: number }>(
    `SELECT id FROM memory_update_proposals
     WHERE new_capture_id = ? AND old_capture_id = ? AND status = 'open' LIMIT 1`,
    newCaptureId, oldCaptureId,
  );
  if (existing) return;
  await db.runAsync(
    `INSERT INTO memory_update_proposals (new_capture_id, old_capture_id, kind, summary, suggested_context)
     VALUES (?, ?, ?, ?, ?)`,
    newCaptureId, oldCaptureId, kind, summary.slice(0, 280), suggestedContext.slice(0, 600),
  );
}

export async function listOpenMemoryUpdateProposals(db: SQLiteDatabase): Promise<MemoryUpdateProposalRow[]> {
  return db.getAllAsync<MemoryUpdateProposalRow>(
    `SELECT p.*,
            substr(nc.raw_transcript, 1, 200) AS new_excerpt,
            substr(oc.raw_transcript, 1, 240) AS old_excerpt,
            oc.extracted_title AS old_title,
            oc.created_at      AS old_created_at
     FROM memory_update_proposals p
     LEFT JOIN captures nc ON nc.id = p.new_capture_id
     LEFT JOIN captures oc ON oc.id = p.old_capture_id
     WHERE p.status = 'open'
       AND oc.id IS NOT NULL   -- old note still exists
     ORDER BY p.created_at DESC, p.id DESC`,
  );
}

export async function countOpenMemoryUpdateProposals(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM memory_update_proposals WHERE status = 'open'",
  );
  return row?.n ?? 0;
}

export async function setMemoryUpdateProposalStatus(
  db: SQLiteDatabase, id: number, status: MemoryUpdateStatus,
): Promise<MemoryUpdateProposalRow | null> {
  const row = await db.getFirstAsync<MemoryUpdateProposalRow>(
    'SELECT * FROM memory_update_proposals WHERE id = ?', id,
  );
  if (!row || row.status !== 'open') return null;
  await db.runAsync('UPDATE memory_update_proposals SET status = ? WHERE id = ?', status, id);
  return row;
}
