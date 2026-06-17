import type { SQLiteDatabase } from 'expo-sqlite';
import type { PrivacyLevel } from '../types/extraction';

/**
 * Merge a follow-up capture INTO an earlier note, in place (the user-chosen merge behavior).
 *
 * The OLD note stays as the single living note and absorbs the new info; the NEW capture is
 * re-parented as a recoverable child "update" so it stops showing as a duplicate on the timeline but
 * is never deleted. The fold is APPEND-ONLY (the old note's original words are preserved verbatim),
 * then the old note is re-extracted so its title/items refresh to the combined version.
 *
 * Used by both the auto-merge path and an approved propose-and-confirm card. Fully reversible.
 */
export async function mergeCaptureUpdateInPlace(
  db: SQLiteDatabase,
  oldCaptureId: number,
  newCaptureId: number,
  context: string,
  mergedTitle: string | null,
): Promise<boolean> {
  if (!oldCaptureId || !newCaptureId || oldCaptureId === newCaptureId) return false;
  const ctx = (context ?? '').trim();
  if (!ctx) return false;

  const old = await db.getFirstAsync<{ raw_transcript: string | null; privacy_level: string | null }>(
    'SELECT raw_transcript, privacy_level FROM captures WHERE id = ?', oldCaptureId,
  );
  const neu = await db.getFirstAsync<{ privacy_level: string | null; extracted_title: string | null }>(
    'SELECT privacy_level, extracted_title FROM captures WHERE id = ?', newCaptureId,
  );
  if (!old) return false;

  // Append-only fold — keeps the old note's original words intact and recoverable.
  const base = (old.raw_transcript ?? '').trim();
  const when = new Date().toLocaleDateString([], { month: 'short', day: 'numeric' });
  const merged = `${base}\n\n[Updated ${when} from a follow-up note: ${ctx}]`;
  await db.runAsync('UPDATE captures SET raw_transcript = ? WHERE id = ?', merged, oldCaptureId);

  // Re-parent the new capture as a recoverable child "update" of the old note. listRecentCaptures
  // only shows top-level (parent_capture_id IS NULL) captures, so it leaves the timeline cleanly.
  const { linkCaptureUpdate, resetCaptureForReprocess } = await import('../db/captures');
  const privacy = ((neu?.privacy_level as PrivacyLevel) ?? (old.privacy_level as PrivacyLevel) ?? 'normal');
  await linkCaptureUpdate(db, newCaptureId, oldCaptureId, privacy, (neu?.extracted_title ?? mergedTitle ?? 'Follow-up update').slice(0, 80));

  // Re-extract the old note so its title + structured items reflect the merged content.
  await resetCaptureForReprocess(db, oldCaptureId);
  const { processQueue } = await import('./extract');
  void processQueue();
  return true;
}
