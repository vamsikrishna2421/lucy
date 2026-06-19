/**
 * Commitment guardian — storage. Promises the user MADE ("I'll send the deck to Raghavendra by Thu")
 * and things they're OWED ("Priya will send me the file"), with deadlines, so LUCY can chase the
 * at-risk ones. Rows are produced by `extractCommitments` (src/processing/commitments.ts) during
 * extraction and surfaced via the `commitments` tool, the morning brief, and a proactive nudge.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import type { PrivacyLevel } from '../types/extraction';
import type { Commitment, CommitmentDirection } from '../processing/commitments';

export type CommitmentStatus = 'open' | 'done' | 'dismissed';

export interface CommitmentRow {
  id: number;
  capture_id: number | null;
  text: string;
  action: string;
  counterparty: string | null;
  due_at: string | null;
  direction: CommitmentDirection;
  status: CommitmentStatus;
  privacy_level: PrivacyLevel;
  nudged_at: string | null;
  resolved_at: string | null;
  created_at: string;
}

function norm(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Insert one extracted commitment, skipping it if an OPEN one for the same direction + counterparty +
 *  (substring-)matching action already exists — so re-capturing the same promise doesn't duplicate it.
 *  Returns the new row id, or null when it was a duplicate. */
export async function insertCommitment(
  db: SQLiteDatabase,
  captureId: number,
  c: Commitment,
  privacyLevel: PrivacyLevel = 'normal',
): Promise<number | null> {
  const existing = await db.getAllAsync<{ action: string; counterparty: string | null }>(
    "SELECT action, counterparty FROM commitments WHERE status = 'open' AND direction = ?",
    c.direction,
  );
  const na = norm(c.action);
  const cp = (c.counterparty ?? '').toLowerCase();
  for (const e of existing) {
    const sameParty = (e.counterparty ?? '').toLowerCase() === cp;
    const ne = norm(e.action ?? '');
    if (sameParty && na.length > 0 && (ne === na || ne.includes(na) || na.includes(ne))) {
      return null; // already tracking this promise
    }
  }
  const res = await db.runAsync(
    'INSERT INTO commitments (capture_id, text, action, counterparty, due_at, direction, privacy_level) VALUES (?, ?, ?, ?, ?, ?, ?)',
    captureId,
    c.text,
    c.action,
    c.counterparty,
    c.dueISO,
    c.direction,
    privacyLevel,
  );
  return res.lastInsertRowId ?? null;
}

export async function listOpenCommitments(db: SQLiteDatabase): Promise<CommitmentRow[]> {
  return db.getAllAsync<CommitmentRow>(
    // Dated ones first (soonest due), then the open-ended ones, newest captured first.
    "SELECT * FROM commitments WHERE status = 'open' ORDER BY (due_at IS NULL), due_at ASC, created_at DESC",
  );
}

export async function countOpenCommitments(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM commitments WHERE status = 'open'");
  return row?.n ?? 0;
}

/** Open commitments that have a deadline already past or within the lookahead window (default 48h),
 *  soonest/most-overdue first. These are the ones worth chasing. */
export async function listAtRiskCommitments(
  db: SQLiteDatabase,
  now = Date.now(),
  withinMs = 48 * 60 * 60 * 1000,
): Promise<CommitmentRow[]> {
  const open = await db.getAllAsync<CommitmentRow>(
    "SELECT * FROM commitments WHERE status = 'open' AND due_at IS NOT NULL",
  );
  return open
    .filter((c) => {
      const due = Date.parse(c.due_at ?? '');
      return Number.isFinite(due) && due <= now + withinMs;
    })
    .sort((a, b) => Date.parse(a.due_at ?? '') - Date.parse(b.due_at ?? ''));
}

export async function markCommitment(db: SQLiteDatabase, id: number, status: 'done' | 'dismissed'): Promise<void> {
  await db.runAsync(
    'UPDATE commitments SET status = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?',
    status,
    id,
  );
}

export async function markCommitmentNudged(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('UPDATE commitments SET nudged_at = CURRENT_TIMESTAMP WHERE id = ?', id);
}
