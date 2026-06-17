import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * Self-improving brain (propose-and-confirm). After a new capture is processed, check whether it
 * corrects or adds context to an EARLIER note. If so, record a PROPOSAL (memory_update_proposals)
 * for the user to approve — we never auto-rewrite existing memory (a wrong LLM judgment would corrupt
 * the brain). Fully guarded + remote-AI-only; returns the number of proposals created (0 on any issue).
 */
export async function proposeMemoryUpdates(db: SQLiteDatabase, newCaptureId: number): Promise<number> {
  try {
    const { resolveRemoteAvailability } = await import('../ai/provider');
    const { available, openAIKey } = await resolveRemoteAvailability();
    if (!available) return 0; // judgment needs the stronger remote model; stay silent otherwise

    const cap = await db.getFirstAsync<{ raw_transcript: string | null; privacy_level: string | null }>(
      'SELECT raw_transcript, privacy_level FROM captures WHERE id = ?', newCaptureId,
    );
    const text = (cap?.raw_transcript ?? '').trim();
    if (text.length < 12 || cap?.privacy_level === 'private') return 0; // skip trivial / private

    const { findSimilarCaptures } = await import('./vectorSearch');
    // High similarity floor so we only consider genuinely-related prior notes.
    const similar = (await findSimilarCaptures(db, text, 4, 0.45)).filter(
      (s) => s.capture.id !== newCaptureId && (s.capture.raw_transcript ?? '').trim() && s.capture.privacy_level !== 'private',
    );
    if (!similar.length) return 0;

    const { promptAI } = await import('../ai/openai');
    const { jsonrepair } = await import('jsonrepair');
    const sys = `You maintain a personal memory ("second brain"). A NEW note just arrived. Decide if it CORRECTS or ADDS CONTEXT to the OLD note — e.g. a follow-up that updates a status, fixes a detail, or supplies new info about the same thing. Return STRICT JSON only, no markdown:
{"action":"correction|enrichment|none","summary":"<one short line for the user: what changed>","context":"<the exact context to fold into the OLD note, first person, under 200 chars>"}
Rules:
- action "none" UNLESS the new note genuinely updates THIS specific old note. Same broad topic with no new/updated info = none.
- "correction" = the new note changes/supersedes a detail in the old note; "enrichment" = adds useful context without contradicting.
- Never invent facts; ground "context" only in the new note.`;

    let made = 0;
    for (const s of similar.slice(0, 2)) { // at most the 2 closest candidates
      let raw: string;
      try {
        raw = await promptAI(sys, `OLD note:\n${(s.capture.raw_transcript ?? '').slice(0, 500)}\n\nNEW note:\n${text.slice(0, 500)}`, openAIKey);
      } catch { continue; }
      try {
        const start = raw.indexOf('{'); const end = raw.lastIndexOf('}');
        if (start < 0 || end < 0) continue;
        const j = JSON.parse(jsonrepair(raw.slice(start, end + 1))) as { action?: string; summary?: string; context?: string };
        const action = String(j.action ?? 'none');
        const context = String(j.context ?? '').trim();
        if ((action === 'correction' || action === 'enrichment') && context) {
          const { insertMemoryUpdateProposal } = await import('../db/memoryUpdateProposals');
          await insertMemoryUpdateProposal(
            db, newCaptureId, s.capture.id, action,
            String(j.summary ?? '').trim() || 'This looks like it updates an earlier note',
            context,
          );
          made++;
        }
      } catch { continue; }
    }
    return made;
  } catch {
    return 0;
  }
}

/**
 * Apply an approved proposal: fold the suggested context into the OLD note as a marked addendum
 * (original words preserved) and re-extract it so the brain re-derives with the correction.
 */
export async function applyMemoryUpdateProposal(db: SQLiteDatabase, id: number): Promise<boolean> {
  const { setMemoryUpdateProposalStatus } = await import('../db/memoryUpdateProposals');
  const row = await setMemoryUpdateProposalStatus(db, id, 'applied');
  if (!row) return false;
  try {
    const old = await db.getFirstAsync<{ raw_transcript: string | null }>(
      'SELECT raw_transcript FROM captures WHERE id = ?', row.old_capture_id,
    );
    const base = (old?.raw_transcript ?? '').trim();
    const addendum = `\n\n[Update from a later note: ${row.suggested_context}]`;
    await db.runAsync('UPDATE captures SET raw_transcript = ? WHERE id = ?', base + addendum, row.old_capture_id);
    const { resetCaptureForReprocess } = await import('../db/captures');
    await resetCaptureForReprocess(db, row.old_capture_id);
    const { processQueue } = await import('./extract');
    void processQueue();
    return true;
  } catch {
    return false;
  }
}
