import type { SQLiteDatabase } from 'expo-sqlite';
import type { ExtractionResult } from '../types/extraction';

export async function insertExtractionSnapshot(
  db: SQLiteDatabase,
  captureId: number,
  extraction: ExtractionResult,
): Promise<void> {
  await db.runAsync(
    'INSERT INTO extractions (capture_id, schema_version, privacy_level, structured_json) VALUES (?, ?, ?, ?)',
    captureId,
    1,
    extraction.privacy_level,
    JSON.stringify(extraction),
  );
}

export interface ExtractionEvidenceRow {
  capture_id: number;
  capture_created_at: string;
  privacy_level: 'private' | 'local' | 'normal';
  structured_json: string;
}

export async function getLatestExtractionForCapture(
  db: SQLiteDatabase,
  captureId: number,
): Promise<string | null> {
  const row = await db.getFirstAsync<{ structured_json: string }>(
    'SELECT structured_json FROM extractions WHERE capture_id = ? ORDER BY id DESC LIMIT 1',
    captureId,
  );
  return row?.structured_json ?? null;
}

export async function listLatestExtractionEvidence(db: SQLiteDatabase): Promise<ExtractionEvidenceRow[]> {
  return db.getAllAsync<ExtractionEvidenceRow>(
    `SELECT e.capture_id, c.created_at AS capture_created_at, e.privacy_level, e.structured_json
     FROM extractions e
     INNER JOIN captures c ON c.id = e.capture_id
     INNER JOIN (
       SELECT capture_id, MAX(id) AS extraction_id FROM extractions GROUP BY capture_id
     ) latest ON latest.extraction_id = e.id
     WHERE c.processed = 1 AND c.parent_capture_id IS NULL
     ORDER BY c.created_at ASC, c.id ASC`,
  );
}
