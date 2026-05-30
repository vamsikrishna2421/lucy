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
  capture_kind: 'thought' | 'update';
  archived_at: string | null;
  archive_reason: string | null;
  guardian_note: string | null;
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
): Promise<number> {
  const result = await db.runAsync(
    'INSERT INTO captures (source, raw_transcript, privacy_level, user_marked_private) VALUES (?, ?, ?, ?)',
    source,
    transcript,
    privacyLevel,
    userMarkedPrivate ? 1 : 0,
  );
  return result.lastInsertRowId;
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
): Promise<void> {
  await db.runAsync(
    'UPDATE captures SET privacy_level = ?, extracted_title = ?, structured_text = ? WHERE id = ?',
    privacyLevel,
    title,
    structuredText,
    id,
  );
}

export async function updateCaptureGuardianNote(db: SQLiteDatabase, id: number, note: string): Promise<void> {
  await db.runAsync('UPDATE captures SET guardian_note = ? WHERE id = ?', note, id);
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
  'extractions', 'capture_embeddings',
] as const;

/** Deletes every derived row for a capture (tasks, ideas, expenses, embeddings,
 *  extraction evidence, …) WITHOUT touching the capture row. Used by both delete and
 *  reprocess so re-running extraction can't leave stale/duplicate derived items. */
export async function purgeCaptureDerivedData(db: SQLiteDatabase, id: number): Promise<void> {
  for (const table of CAPTURE_DERIVED_TABLES) {
    await db.runAsync(`DELETE FROM ${table} WHERE capture_id = ?`, id);
  }
}

/**
 * Resets a capture for reprocessing: purges its previously-extracted derived rows and
 * clears the extracted result so re-running extraction starts clean (no duplicates),
 * then re-queues it. Returns it to the processing queue (processed = 0).
 */
export async function resetCaptureForReprocess(db: SQLiteDatabase, id: number): Promise<void> {
  await db.withTransactionAsync(async () => {
    await purgeCaptureDerivedData(db, id);
    await db.runAsync(
      `UPDATE captures SET processed = 0, processing_error = NULL, attempt_count = 0,
       next_attempt_at = NULL, extracted_title = NULL, structured_text = NULL WHERE id = ?`,
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
export async function deleteCaptureCompletely(db: SQLiteDatabase, id: number, reason = 'deleted by user'): Promise<void> {
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
     ORDER BY CASE WHEN processed = 0 THEN 0 ELSE 1 END, created_at ASC, id ASC LIMIT 1`,
  );
}

export async function markCaptureProcessing(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync(
    'UPDATE captures SET processed = 2, processing_error = NULL, next_attempt_at = NULL, attempt_count = attempt_count + 1 WHERE id = ?',
    id,
  );
}

export async function markCaptureFailed(db: SQLiteDatabase, id: number, error: string): Promise<void> {
  await db.runAsync(
    `UPDATE captures SET processed = -1, processing_error = ?,
     next_attempt_at = datetime('now', CASE WHEN attempt_count <= 1 THEN '+30 seconds' WHEN attempt_count = 2 THEN '+2 minutes' ELSE '+10 minutes' END)
     WHERE id = ?`,
    error,
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
