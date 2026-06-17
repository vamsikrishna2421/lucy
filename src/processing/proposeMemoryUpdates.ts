import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * Self-improving brain. After a new capture is processed, check whether it updates an EARLIER note
 * (e.g. a re-photographed to-do list with more items, or a follow-up that adds context).
 *
 * Behavior (user-decided 2026-06-17):
 *  - MERGE = update the OLD note IN PLACE — it absorbs the new info and stays the single living note;
 *    the new capture is re-parented as a recoverable child "update" (never deleted).
 *  - AUTO when OBVIOUS — a high-confidence ADDITIVE superset about the same subject merges silently
 *    (a brain pulse records it). Anything contradicting or ambiguous becomes a propose-and-confirm
 *    CARD instead — we never silently rewrite memory on a shaky judgment.
 *
 * Safety: the merge is append-only on the old note (original words preserved) and the new capture is
 * archived as a child, so every merge is fully reversible. Fully guarded + remote-AI-only.
 */
export async function proposeMemoryUpdates(db: SQLiteDatabase, newCaptureId: number): Promise<number> {
  try {
    const { resolveRemoteAvailability } = await import('../ai/provider');
    const { available, openAIKey } = await resolveRemoteAvailability();
    if (!available) return 0; // judgment needs the stronger remote model; stay silent otherwise

    const cap = await db.getFirstAsync<{ raw_transcript: string | null; privacy_level: string | null; capture_kind: string | null }>(
      'SELECT raw_transcript, privacy_level, capture_kind FROM captures WHERE id = ?', newCaptureId,
    );
    const text = (cap?.raw_transcript ?? '').trim();
    if (text.length < 12 || cap?.privacy_level === 'private') return 0; // skip trivial / private
    if (cap?.capture_kind === 'update') return 0; // don't chain off a note that's itself an update

    const { findSimilarCaptures } = await import('./vectorSearch');
    // High similarity floor so we only consider genuinely-related prior notes.
    const similar = (await findSimilarCaptures(db, text, 4, 0.45)).filter(
      (s) => s.capture.id !== newCaptureId
        && (s.capture.raw_transcript ?? '').trim()
        && s.capture.privacy_level !== 'private'
        && s.capture.parent_capture_id == null            // don't target child updates
        && (s.capture as { capture_kind?: string }).capture_kind !== 'update',
    );
    if (!similar.length) return 0;

    const { promptAI } = await import('../ai/openai');
    const { jsonrepair } = await import('jsonrepair');
    const sys = `You maintain a personal memory ("second brain"). A NEW note just arrived. Decide if it UPDATES the OLD note — e.g. a follow-up that adds items/context, fixes a detail, or supersedes it (like the same to-do list re-photographed with more items). Return STRICT JSON only, no markdown:
{"action":"enrichment|correction|none","same_subject":true|false,"superset":true|false,"confidence":"high|medium|low","summary":"<one short line for the user: what changed>","context":"<the exact new info to fold into the OLD note, first person, under 200 chars>","merged_title":"<a concise title for the combined note, under 70 chars>"}
Rules:
- action "none" UNLESS the new note genuinely updates THIS specific old note. Same broad topic with no new/updated info = none.
- "enrichment" = purely ADDITIVE (adds items/context, contradicts nothing). "correction" = changes/supersedes a detail (contradicts the old note).
- same_subject = the two notes are about the SAME specific thing (same list/event/task), not just the same topic.
- superset = the new note contains everything relevant in the old note PLUS more.
- confidence = how sure you are this is the same subject and a real update.
- Never invent facts; ground "context" only in the new note.`;

    const { mergeCaptureUpdateInPlace } = await import('./mergeCapture');
    let made = 0;
    for (const s of similar.slice(0, 2)) { // at most the 2 closest candidates
      let raw: string;
      try {
        raw = await promptAI(sys, `OLD note:\n${(s.capture.raw_transcript ?? '').slice(0, 500)}\n\nNEW note:\n${text.slice(0, 500)}`, openAIKey);
      } catch { continue; }
      try {
        const start = raw.indexOf('{'); const end = raw.lastIndexOf('}');
        if (start < 0 || end < 0) continue;
        const j = JSON.parse(jsonrepair(raw.slice(start, end + 1))) as {
          action?: string; same_subject?: boolean; superset?: boolean; confidence?: string;
          summary?: string; context?: string; merged_title?: string;
        };
        const action = String(j.action ?? 'none');
        const context = String(j.context ?? '').trim();
        if (action !== 'enrichment' && action !== 'correction') continue;
        if (!context) continue;
        const summary = String(j.summary ?? '').trim() || 'This looks like it updates an earlier note';
        const sim = s.signals?.semantic ?? s.score ?? 0;

        // OBVIOUS = additive superset, same subject, high confidence, strong similarity → auto-merge
        // silently. A contradicting "correction" never auto-applies; it always asks first.
        const obvious = action === 'enrichment'
          && j.same_subject === true
          && j.superset === true
          && String(j.confidence) === 'high'
          && sim >= 0.7;

        if (obvious) {
          const ok = await mergeCaptureUpdateInPlace(db, s.capture.id, newCaptureId, context, String(j.merged_title ?? '').trim());
          if (ok) {
            const { insertBrainPulse } = await import('../db/brainPulses');
            await insertBrainPulse(db, 'connection', 'Merged a follow-up into an earlier note', summary, [s.capture.id, newCaptureId]);
            return 1; // merged into one note — don't also process this capture against other candidates
          }
        }
        // Otherwise propose-and-confirm: record a card the user approves on next app open.
        const { insertMemoryUpdateProposal } = await import('../db/memoryUpdateProposals');
        await insertMemoryUpdateProposal(
          db, newCaptureId, s.capture.id, action === 'correction' ? 'correction' : 'enrichment', summary, context,
        );
        made++;
      } catch { continue; }
    }
    return made;
  } catch {
    return 0;
  }
}

/**
 * Apply an approved proposal — same in-place merge as the auto path: fold the context into the OLD
 * note, re-extract it, and re-parent the new capture as a recoverable child update.
 */
export async function applyMemoryUpdateProposal(db: SQLiteDatabase, id: number): Promise<boolean> {
  const { setMemoryUpdateProposalStatus } = await import('../db/memoryUpdateProposals');
  const row = await setMemoryUpdateProposalStatus(db, id, 'applied');
  if (!row) return false;
  try {
    const { mergeCaptureUpdateInPlace } = await import('./mergeCapture');
    return await mergeCaptureUpdateInPlace(db, row.old_capture_id, row.new_capture_id, row.suggested_context, null);
  } catch {
    return false;
  }
}
