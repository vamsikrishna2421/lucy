import type { SQLiteDatabase } from 'expo-sqlite';
import type { CaptureSource, PrivacyLevel } from '../types/extraction';

export interface CaptureRow {
  id: number;
  created_at: string;
  source: CaptureSource;
  raw_transcript: string;
  privacy_level: PrivacyLevel;
  user_marked_private: number;
  processed: number;
  processing_error: string | null;
  extracted_title: string | null;
  structured_text: string | null;
  processed_at: string | null;
  attempt_count: number;
  next_attempt_at: string | null;
  parent_capture_id: number | null;
  split_origin_id: number | null;
  capture_kind: 'thought' | 'update';
  archived_at: string | null;
  archive_reason: string | null;
  guardian_note: string | null;
  listen_session_id: string | null;
  protected_values: string | null;
  source_image_path: string | null;
  importance: 'low' | 'normal' | 'high' | null;
}

/** A capture trimmed for the "free up space" cleanup list. */
export interface CleanupCapture {
  id: number;
  created_at: string;
  title: string;
  snippet: string;
  importance: 'low' | 'normal' | 'high';
  has_image: boolean;
}

/**
 * Least-important, oldest captures for the "free up space" cleanup screen — low importance first, then
 * oldest first. Skips already-archived rows. The user multi-selects + deletes to reclaim space.
 */
export async function getLowImportanceCaptures(db: SQLiteDatabase, limit = 200): Promise<CleanupCapture[]> {
  const rows = await db.getAllAsync<{ id: number; created_at: string; extracted_title: string | null; raw_transcript: string | null; importance: string | null; source_image_path: string | null }>(
    `SELECT id, created_at, extracted_title, raw_transcript, importance, source_image_path
       FROM captures
      WHERE archived_at IS NULL AND COALESCE(importance, 'normal') != 'high'
      ORDER BY CASE COALESCE(importance, 'normal') WHEN 'low' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END ASC,
               created_at ASC
      LIMIT ?`,
    limit,
  );
  return rows.map((r) => ({
    id: r.id,
    created_at: r.created_at,
    title: (r.extracted_title || (r.raw_transcript || '').slice(0, 50) || 'Note').trim(),
    snippet: (r.raw_transcript || '').slice(0, 120).replace(/\s+/g, ' ').trim(),
    importance: (r.importance === 'low' || r.importance === 'high') ? r.importance : 'normal',
    has_image: !!r.source_image_path,
  }));
}

/** Links the on-device original photo (LUCY Lens source-of-truth) to a capture. */
export async function setCaptureSourceImage(db: SQLiteDatabase, id: number, path: string): Promise<void> {
  await db.runAsync('UPDATE captures SET source_image_path = ? WHERE id = ?', path, id);
}

export type CaptureStatus = 'queued' | 'processing' | 'complete' | 'retrying' | 'archived';

export interface CaptureQueueSummary {
  queued: number;
  processing: number;
  retrying: number;
  complete: number;
  archived: number;
}

export function captureStatus(capture: CaptureRow): CaptureStatus {
  if (capture.processed === 3) {
    return 'archived';
  }
  if (capture.processed === 1) {
    return 'complete';
  }
  if (capture.processed === 2) {
    return 'processing';
  }
  if (capture.processed === -1) {
    return 'retrying';
  }
  return 'queued';
}

export async function insertCapture(
  db: SQLiteDatabase,
  source: CaptureSource,
  transcript: string,
  privacyLevel: PrivacyLevel,
  userMarkedPrivate = false,
  listenSessionId: string | null = null,
): Promise<number> {
  const result = await db.runAsync(
    'INSERT INTO captures (source, raw_transcript, privacy_level, user_marked_private, listen_session_id) VALUES (?, ?, ?, ?, ?)',
    source,
    transcript,
    privacyLevel,
    userMarkedPrivate ? 1 : 0,
    listenSessionId,
  );
  return result.lastInsertRowId;
}

/**
 * Records a voice command that performed an ACTION (scheduled an event, created a task/project, saved
 * a link, logged a mood) as a finished timeline note, so every voice capture always shows on the Home
 * timeline IN ADDITION to whatever it did. Marked processed=1 with a title + the user's original words,
 * so the extraction pipeline does NOT re-run it (which would duplicate the task/project it already made).
 */
export async function logVoiceActionToTimeline(
  db: SQLiteDatabase,
  source: CaptureSource,
  rawText: string,
  title: string,
): Promise<number> {
  const body = (rawText ?? '').trim();
  if (!body) return 0;
  const id = await insertCapture(db, source, body, 'normal');
  await db.runAsync(
    `UPDATE captures SET processed = 1, processed_at = CURRENT_TIMESTAMP, next_attempt_at = NULL,
       extracted_title = ?, structured_text = ? WHERE id = ?`,
    (title || body).slice(0, 80),
    body,
    id,
  );
  return id;
}

export interface ListenSessionGroup {
  sessionId: string;
  startedAt: string;
  endedAt: string;
  captureCount: number;
  captureIds: number[];
  snippets: string[];
}

/** Groups passive captures by listen_session_id for the Brain → Listen tab. */
export async function listListenSessions(db: SQLiteDatabase): Promise<ListenSessionGroup[]> {
  const rows = await db.getAllAsync<{ id: number; listen_session_id: string | null; raw_transcript: string; created_at: string }>(
    `SELECT id, listen_session_id, raw_transcript, created_at
     FROM captures
     WHERE source = 'passive' AND archived_at IS NULL
     ORDER BY created_at ASC, id ASC`,
  );
  const map = new Map<string, ListenSessionGroup>();
  for (const row of rows) {
    const key = row.listen_session_id ?? `legacy-${row.created_at.slice(0, 13)}`; // group legacy by hour
    const existing = map.get(key);
    const snippet = (row.raw_transcript ?? '').slice(0, 100).trim();
    if (existing) {
      existing.captureCount += 1;
      existing.captureIds.push(row.id);
      existing.endedAt = row.created_at;
      if (existing.snippets.length < 3 && snippet) existing.snippets.push(snippet);
    } else {
      map.set(key, { sessionId: key, startedAt: row.created_at, endedAt: row.created_at, captureCount: 1, captureIds: [row.id], snippets: snippet ? [snippet] : [] });
    }
  }
  return [...map.values()].reverse(); // newest first
}

export async function insertSharedCapture(
  db: SQLiteDatabase,
  source: 'android' | 'ios',
  transcript: string,
  privacyLevel: PrivacyLevel,
  userMarkedPrivate = false,
): Promise<number> {
  const existing = await db.getFirstAsync<{ id: number }>(
    `SELECT id FROM captures
     WHERE source = ? AND raw_transcript = ? AND created_at >= datetime('now', '-10 minutes')
     ORDER BY id DESC LIMIT 1`,
    source,
    transcript,
  );
  if (existing) {
    return existing.id;
  }
  return insertCapture(db, source, transcript, privacyLevel, userMarkedPrivate);
}

export async function markCaptureProcessed(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync(
    'UPDATE captures SET processed = 1, processing_error = NULL, processed_at = CURRENT_TIMESTAMP, next_attempt_at = NULL WHERE id = ?',
    id,
  );
}

export async function updateCaptureResult(
  db: SQLiteDatabase,
  id: number,
  privacyLevel: PrivacyLevel,
  title: string,
  structuredText: string,
  importance: 'low' | 'normal' | 'high' = 'normal',
): Promise<void> {
  await db.runAsync(
    'UPDATE captures SET privacy_level = ?, extracted_title = ?, structured_text = ?, importance = ? WHERE id = ?',
    privacyLevel,
    title,
    structuredText,
    importance,
    id,
  );
}

export async function updateCaptureGuardianNote(db: SQLiteDatabase, id: number, note: string): Promise<void> {
  await db.runAsync('UPDATE captures SET guardian_note = ? WHERE id = ?', note, id);
}

/** Stores the Privacy Shield's protected values (JSON [{value, kind}]) for UI highlighting. */
export async function updateCaptureProtectedValues(
  db: SQLiteDatabase,
  id: number,
  protectedValues: Array<{ value: string; kind: 'secret' | 'person' }>,
): Promise<void> {
  await db.runAsync(
    'UPDATE captures SET protected_values = ? WHERE id = ?',
    protectedValues.length ? JSON.stringify(protectedValues) : null,
    id,
  );
}

export async function updateCaptureStructuredText(
  db: SQLiteDatabase,
  id: number,
  structuredText: string,
): Promise<void> {
  await db.runAsync('UPDATE captures SET structured_text = ? WHERE id = ?', structuredText, id);
}

export async function linkCaptureUpdate(
  db: SQLiteDatabase,
  id: number,
  parentCaptureId: number,
  privacyLevel: PrivacyLevel,
  title: string,
): Promise<void> {
  await db.runAsync(
    `UPDATE captures SET parent_capture_id = ?, capture_kind = 'update',
     privacy_level = ?, extracted_title = ?
     WHERE id = ?`,
    parentCaptureId,
    privacyLevel,
    title,
    id,
  );
}

export async function archiveCapture(db: SQLiteDatabase, id: number, reason: string): Promise<void> {
  await db.runAsync(
    `UPDATE captures SET processed = 3, processing_error = NULL, next_attempt_at = NULL,
     archived_at = CURRENT_TIMESTAMP, archive_reason = ?
     WHERE id = ?`,
    reason,
    id,
  );
}

/** Tables that hold rows derived from a capture's extraction. Deleting a memory must
 *  purge these so it disappears from the Brain/Library and Ask, not just the timeline. */
const CAPTURE_DERIVED_TABLES = [
  'todos', 'expenses', 'ideas', 'places', 'reminders',
  'open_loops', 'follow_ups', 'context_requests', 'mood_entries',
  'extractions', 'capture_embeddings', 'pending_actions',
] as const;

/**
 * Rows that REFERENCE a capture but aren't owned by it (so we null/clear, not delete the row).
 * knowledge_entities/connections keep a `latest_capture_id` pointer (FK, no ON DELETE rule) that
 * would block a hard delete; memory_update_proposals points at it without an FK but shouldn't dangle.
 */
async function clearCaptureBackReferences(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('UPDATE knowledge_entities SET latest_capture_id = NULL WHERE latest_capture_id = ?', id);
  await db.runAsync('UPDATE knowledge_connections SET latest_capture_id = NULL WHERE latest_capture_id = ?', id);
  try { await db.runAsync('DELETE FROM memory_update_proposals WHERE new_capture_id = ? OR old_capture_id = ?', id, id); } catch { /* table may predate this feature */ }
}

/** Deletes every derived row for a capture (tasks, ideas, expenses, embeddings,
 *  extraction evidence, …) WITHOUT touching the capture row. Used by both delete and
 *  reprocess so re-running extraction can't leave stale/duplicate derived items. */
export async function purgeCaptureDerivedData(db: SQLiteDatabase, id: number): Promise<void> {
  for (const table of CAPTURE_DERIVED_TABLES) {
    await db.runAsync(`DELETE FROM ${table} WHERE capture_id = ?`, id);
  }
}

/**
 * Permanently removes a capture row and ALL of its references — derived rows, back-references, and
 * any child "update" captures (which reference it via parent_capture_id, an FK with no ON DELETE
 * rule). Without clearing those first, `DELETE FROM captures` fails with a foreign-key violation
 * (the cause of the 500s when hard-deleting segmented/merged captures). All-or-nothing transaction.
 * Returns true if the target row was removed.
 */
export async function hardDeleteCapture(db: SQLiteDatabase, id: number): Promise<boolean> {
  const exists = await db.getFirstAsync<{ id: number }>('SELECT id FROM captures WHERE id = ?', id);
  if (!exists) return false;
  // Collect the capture + every descendant (children-of-children) that points back via parent_capture_id.
  const all: number[] = [id];
  for (let i = 0; i < all.length; i++) {
    const kids = await db.getAllAsync<{ id: number }>('SELECT id FROM captures WHERE parent_capture_id = ?', all[i]);
    for (const k of kids) if (!all.includes(k.id)) all.push(k.id);
  }
  let removed = false;
  await db.withTransactionAsync(async () => {
    for (const cid of all) {
      await purgeCaptureDerivedData(db, cid);
      await clearCaptureBackReferences(db, cid);
    }
    // Delete descendants before ancestors so no parent_capture_id FK is left dangling mid-delete.
    for (let i = all.length - 1; i >= 0; i--) {
      const r = await db.runAsync('DELETE FROM captures WHERE id = ?', all[i]);
      if (all[i] === id) removed = r.changes > 0;
    }
  });
  return removed;
}

/**
 * Resets a capture for reprocessing: purges its previously-extracted derived rows and
 * clears the extracted result so re-running extraction starts clean (no duplicates),
 * then re-queues it. Returns it to the processing queue (processed = 0).
 */
export async function resetCaptureForReprocess(db: SQLiteDatabase, id: number): Promise<void> {
  // If this capture previously split into children (journal → dated/event captures),
  // remove those first so re-splitting cannot create duplicates.
  const priorSplits = await db.getAllAsync<{ id: number }>(
    'SELECT id FROM captures WHERE split_origin_id = ?', id,
  );
  await db.withTransactionAsync(async () => {
    for (const child of priorSplits) {
      await purgeCaptureDerivedData(db, child.id);
      await db.runAsync('DELETE FROM captures WHERE id = ?', child.id);
    }
    await purgeCaptureDerivedData(db, id);
    await db.runAsync(
      `UPDATE captures SET processed = 0, processing_error = NULL, attempt_count = 0,
       next_attempt_at = NULL, extracted_title = NULL, structured_text = NULL,
       archived_at = NULL, archive_reason = NULL WHERE id = ?`,
      id,
    );
  });
}

/**
 * Fully removes a memory from the "brain": purges every derived row (tasks, ideas,
 * expenses, embeddings, extraction evidence, …) for the capture and any child update
 * captures, then soft-archives the capture itself (kept for audit, hidden everywhere).
 * Callers should run organizeMemory() afterwards to rebuild the knowledge projection.
 */
export async function deleteCaptureCompletely(db: SQLiteDatabase, id: number, reason = 'deleted by user'): Promise<boolean> {
  // Don't claim success for an id that isn't a live capture (honest API responses).
  const exists = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM captures WHERE id = ? AND archived_at IS NULL', id,
  );
  if (!exists) return false;
  const children = await db.getAllAsync<{ id: number }>(
    'SELECT id FROM captures WHERE parent_capture_id = ?', id,
  );
  const ids = [id, ...children.map((c) => c.id)];
  await db.withTransactionAsync(async () => {
    for (const captureId of ids) {
      await purgeCaptureDerivedData(db, captureId);
    }
    // Detach + archive child update captures so they don't dangle, then archive the parent.
    for (const child of children) {
      await db.runAsync(
        `UPDATE captures SET parent_capture_id = NULL, processed = 3, processing_error = NULL,
         next_attempt_at = NULL, archived_at = CURRENT_TIMESTAMP, archive_reason = ? WHERE id = ?`,
        reason, child.id,
      );
    }
    await db.runAsync(
      `UPDATE captures SET processed = 3, processing_error = NULL, next_attempt_at = NULL,
       archived_at = CURRENT_TIMESTAMP, archive_reason = ? WHERE id = ?`,
      reason, id,
    );
  });
  return true;
}

export async function resetInterruptedCaptures(db: SQLiteDatabase): Promise<void> {
  await db.runAsync(
    `UPDATE captures SET processed = 0, processing_error = NULL, next_attempt_at = NULL
     WHERE processed = 2 OR (processed = -1 AND next_attempt_at IS NULL)`,
  );
}

/** Force-retry ALL stuck captures (retrying or failed) immediately */
export async function forceRetryAll(db: SQLiteDatabase): Promise<number> {
  const result = await db.runAsync(
    `UPDATE captures SET processed = 0, processing_error = NULL, next_attempt_at = NULL, attempt_count = 0
     WHERE processed = -1 OR processed = 2`,
  );
  return result.changes;
}

/** Get the first retrying capture so user can see what's stuck */
export async function getRetryingCaptures(db: SQLiteDatabase): Promise<CaptureRow[]> {
  return db.getAllAsync<CaptureRow>(
    `SELECT * FROM captures WHERE (processed = -1 OR processed = 2) AND archived_at IS NULL ORDER BY created_at DESC LIMIT 5`,
  );
}

export async function nextQueuedCapture(db: SQLiteDatabase): Promise<CaptureRow | null> {
  return db.getFirstAsync<CaptureRow>(
    `SELECT * FROM captures
     WHERE processed = 0 OR (processed = -1 AND next_attempt_at IS NOT NULL AND next_attempt_at <= CURRENT_TIMESTAMP)
     ORDER BY
       CASE WHEN processed = 0 THEN 0 ELSE 1 END,
       -- Large captures (journals that chunk into many sequential LLM calls) go LAST so a
       -- quick thought never waits behind a 90-day journal monopolizing the queue.
       CASE WHEN length(raw_transcript) > 3000 THEN 1 ELSE 0 END,
       created_at ASC, id ASC
     LIMIT 1`,
  );
}

export async function markCaptureProcessing(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync(
    'UPDATE captures SET processed = 2, processing_error = NULL, next_attempt_at = NULL, attempt_count = attempt_count + 1 WHERE id = ?',
    id,
  );
}

/** Max automatic retries before a capture becomes terminal (user must reprocess manually). */
export const MAX_AUTO_RETRIES = 5;

export async function markCaptureFailed(db: SQLiteDatabase, id: number, error: string): Promise<void> {
  // Billing / quota / rate-limit errors are NOT transient — auto-retrying them is
  // pointless and, worse, the moment balance is restored EVERY queued failure re-runs at
  // once and burns credits. Mark those terminal (no next_attempt_at) so the user decides
  // when to retry. Also stop auto-retrying any capture after MAX_AUTO_RETRIES attempts.
  const lower = error.toLowerCase();
  const terminal = /balance|credit|quota|billing|insufficient|payment|too many requests|rate limit|\b429\b|\b402\b/.test(lower);
  await db.runAsync(
    `UPDATE captures SET processed = -1, processing_error = ?,
     next_attempt_at = CASE
       WHEN ? = 1 THEN NULL
       WHEN attempt_count >= ? THEN NULL
       WHEN attempt_count <= 1 THEN datetime('now', '+30 seconds')
       WHEN attempt_count = 2 THEN datetime('now', '+2 minutes')
       ELSE datetime('now', '+10 minutes') END
     WHERE id = ?`,
    error,
    terminal ? 1 : 0,
    MAX_AUTO_RETRIES,
    id,
  );
}

/**
 * Graceful fallback when the AI can't structure a capture (e.g. the model didn't return JSON, or
 * we're out of credits). Instead of leaving a scary "Couldn't organize — tap to retry" badge that
 * makes end users think the app is broken, we just keep their words as a plain, readable note:
 * the raw text becomes the memory, marked done. Nothing is lost and it can still be reprocessed.
 */
export async function saveCaptureAsPlainNote(db: SQLiteDatabase, id: number, rawText: string): Promise<void> {
  const clean = (rawText ?? '').trim();
  const firstLine = clean.split('\n').map((l) => l.trim()).find((l) => l.length) ?? 'Note';
  const title = firstLine.length > 60 ? `${firstLine.slice(0, 57)}…` : firstLine;
  await db.runAsync(
    `UPDATE captures SET processed = 1, processing_error = NULL, processed_at = CURRENT_TIMESTAMP,
       next_attempt_at = NULL,
       extracted_title = COALESCE(NULLIF(extracted_title, ''), ?),
       structured_text = COALESCE(NULLIF(structured_text, ''), ?)
     WHERE id = ?`,
    title,
    clean || title,
    id,
  );
}

export async function retryCapture(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('UPDATE captures SET processed = 0, processing_error = NULL, next_attempt_at = NULL WHERE id = ?', id);
}

export async function listRecentCaptures(db: SQLiteDatabase, limit = 30): Promise<CaptureRow[]> {
  // Show all non-archived captures regardless of processing state.
  // processed=3 (fully extracted) should still appear in the timeline.
  return db.getAllAsync<CaptureRow>(
    'SELECT * FROM captures WHERE parent_capture_id IS NULL AND archived_at IS NULL ORDER BY created_at DESC, id DESC LIMIT ?',
    limit,
  );
}

export async function listCaptureUpdates(
  db: SQLiteDatabase,
  parentCaptureIds: number[],
): Promise<CaptureRow[]> {
  if (!parentCaptureIds.length) {
    return [];
  }
  const placeholders = parentCaptureIds.map(() => '?').join(', ');
  return db.getAllAsync<CaptureRow>(
    `SELECT * FROM captures WHERE parent_capture_id IN (${placeholders})
     ORDER BY created_at ASC, id ASC`,
    ...parentCaptureIds,
  );
}

export async function getCaptureQueueSummary(db: SQLiteDatabase): Promise<CaptureQueueSummary> {
  const row = await db.getFirstAsync<{
    queued: number | null;
    processing: number | null;
    retrying: number | null;
    complete: number | null;
    archived: number | null;
  }>(
    `SELECT
      SUM(CASE WHEN processed = 0 THEN 1 ELSE 0 END) AS queued,
      SUM(CASE WHEN processed = 2 THEN 1 ELSE 0 END) AS processing,
      SUM(CASE WHEN processed = -1 THEN 1 ELSE 0 END) AS retrying,
      SUM(CASE WHEN processed = 1 THEN 1 ELSE 0 END) AS complete,
      SUM(CASE WHEN processed = 3 THEN 1 ELSE 0 END) AS archived
    FROM captures`,
  );
  return {
    queued: Number(row?.queued ?? 0),
    processing: Number(row?.processing ?? 0),
    retrying: Number(row?.retrying ?? 0),
    complete: Number(row?.complete ?? 0),
    archived: Number(row?.archived ?? 0),
  };
}
