import type { SQLiteDatabase } from 'expo-sqlite';
import { listAnsweredContextRequests } from '../db/contextRequests';
import { updateCaptureStructuredText } from '../db/captures';
import { listLatestExtractionEvidence } from '../db/extractions';
import { replaceKnowledgeProjection, type KnowledgeInsightDraft } from '../db/knowledge';
import { listRecognizedQuestionIntentSummaries } from '../db/questions';
import type { ExtractionResult } from '../types/extraction';
import { formatStructuredMemory } from './structuredMemory';
import { sendGuardianNotification } from './notifications';
import { confidenceFromEvidence, deriveKnowledgeProjection } from './knowledgeProjection';

// The pure knowledge-graph projection (entities + honest co-occurrence connections) lives in
// ./knowledgeProjection (no DB/native imports, unit-tested in tests/organizer.ts). This module wires it
// into the database + the daily organize pass.

export { confidenceFromEvidence, deriveKnowledgeProjection } from './knowledgeProjection';

export async function organizeMemory(db: SQLiteDatabase, trigger: string): Promise<void> {
  const [evidence, clarified, questionIntents] = await Promise.all([
    listLatestExtractionEvidence(db),
    listAnsweredContextRequests(db),
    listRecognizedQuestionIntentSummaries(db),
  ]);
  const projection = deriveKnowledgeProjection(evidence);
  for (const row of evidence) {
    try {
      await updateCaptureStructuredText(db, row.capture_id, formatStructuredMemory(JSON.parse(row.structured_json) as ExtractionResult));
    } catch {
      // A malformed historical extraction remains auditable but cannot generate structured display text.
    }
  }
  // A clarification only becomes an insight if it ADDS knowledge — not "I don't remember",
  // not a "discard/forget this" command (those are noise / removal intents, not insights).
  const clarificationIsSubstantive = (answer: string | null | undefined): boolean => {
    const a = (answer ?? '').trim(); if (a.length <= 2) return false;
    const low = a.toLowerCase();
    if (/\b(discard|forget|drop|remove|delete)\b/.test(low) && /\b(brain|memor|completely|this|it|that)\b/.test(low)) return false;
    if (/^(i\s+(really\s+)?(don'?t|do\s*not|dont)\s+(remember|know|recall)|no idea|idk|not sure|don'?t know|dont know|nothing|none|n\/?a|na|skip|maybe)\b/.test(low)) {
      if (!/\b(but|however|actually|it'?s|its|basically|i think i|i did|implemented|because it'?s)\b/.test(low)) return false;
    }
    return true;
  };
  const norm = (s: string | null | undefined): string => (s ?? 'context').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'context';
  const insights: KnowledgeInsightDraft[] = [
    ...clarified
      .filter((context) => clarificationIsSubstantive(context.answer_text))
      .map((context) => ({
        // Key by topic (not row id) so re-clarifying the same thing updates one insight, not many.
        key: `clarification:${norm(context.snippet)}`,
        type: 'clarification',
        title: `Clarified memory: ${context.snippet?.trim() || 'Additional context'}`,
        detail: context.answer_text?.trim() || 'Context was provided.',
        evidenceCount: 1,
        confidence: 'confirmed' as const,
        privacyLevel: 'private' as const,
        observedAt: context.answered_at,
      })),
    ...questionIntents
      // Drop low-value boilerplate: a generic "Useful view requested" with no specific meaning is
      // noise. Only surface a recognized, named view, and only once it's a real pattern (asked 2+).
      .filter((intent) => intent.intent === 'today_pending_tasks_and_deadlines' && intent.count >= 2)
      .map((intent) => ({
        key: `question-intent:${intent.intent}`,
        type: 'requested_view',
        title: 'Useful view: today tasks and deadlines',
        detail: `Asked ${intent.count} times. LUCY can prioritize this view during future organization.`,
        evidenceCount: intent.count,
        confidence: confidenceFromEvidence(intent.count),
        privacyLevel: 'private' as const,
        observedAt: intent.last_asked_at,
      })),
  ];
  // Dedup by key (topic-keyed clarifications can collide) — keep the latest, avoid UNIQUE clashes.
  const uniqueInsights = Array.from(new Map(insights.map((i) => [i.key, i])).values());
  const summary = `Organized ${evidence.length} remembered thought${evidence.length === 1 ? '' : 's'} into ${projection.entities.length} entities, ${projection.connections.length} connections, and ${uniqueInsights.length} insights.`;
  await replaceKnowledgeProjection(db, projection.entities, projection.connections, uniqueInsights, trigger, summary);

  const freshlyConfirmed = projection.entities.filter(
    (entity) => entity.confidence === 'confirmed' && entity.evidenceCount === 3,
  );
  if (freshlyConfirmed.length > 0) {
    const entityNames = freshlyConfirmed.map((entity) => entity.name);
    // Spam guard: if we already surfaced an insight for THIS exact topic (entity set) in the last
    // 24h, skip — don't regenerate a reworded duplicate (and save the LLM call). Re-derivations of
    // the same topic overwrite in place via sendGuardianNotification's stable identifier.
    try {
      const { guardianTopicIdentifier } = await import('./notifications');
      const { recentNotifByIdentifierExists } = await import('../db/notificationLog');
      const id = guardianTopicIdentifier('guardian', entityNames);
      if (id && await recentNotifByIdentifierExists(db, id, 24 * 60 * 60 * 1000)) {
        // already have a fresh insight for this topic — stay quiet
      } else {
        // Don't notify just because a topic recurs ("you keep coming back to X — I connected the dots"
        // is noise). Generate ONE genuinely useful, grounded, actionable insight — or stay silent.
        const line = await actionableEntityInsight(db, entityNames);
        if (line) await sendGuardianNotification(line, { entityNames, evidenceCount: 3, kind: 'guardian', message: line });
      }
    } catch { /* non-critical */ }
  }

  // Daily "learns about you" reflection — piggybacks the periodic background pass.
  // Self-gated to once/day and never throws, so it's safe to fire-and-forget.
  if (trigger === 'background') {
    void import('./reflectOnUser').then(({ reflectOnUser }) => reflectOnUser(db)).catch(() => {});
    // Self-heal: drop junk People (user themselves / orgs) + decay stale open loops +
    // collapse near-duplicate learned facts the LLM restated across reflections.
    void import('../db/people').then(({ cleanupJunkPeople }) => cleanupJunkPeople(db)).catch(() => {});
    void import('../db/openLoops').then(({ decayStaleOpenLoops }) => decayStaleOpenLoops(db)).catch(() => {});
    void import('../db/learnedProfile').then(({ dedupLearnedFacts }) => dedupLearnedFacts(db)).catch(() => {});
    void import('../db/todos').then(({ cleanupJunkTodos }) => cleanupJunkTodos(db)).catch(() => {});
  }
}

/**
 * Generate ONE genuinely useful, actionable insight about entities the user keeps referencing —
 * grounded strictly in their recent notes. Returns null (LUCY stays silent) when remote AI is
 * unavailable or there's nothing specific worth saying, so she never sends low-value
 * "I connected the dots / you keep coming back to X" noise.
 */
async function actionableEntityInsight(db: SQLiteDatabase, entityNames: string[]): Promise<string | null> {
  try {
    const { resolveRemoteAvailability } = await import('../ai/provider');
    const { available, openAIKey } = await resolveRemoteAvailability();
    if (!available) return null; // no AI → better to say nothing than to send filler

    const { listRecentCaptures } = await import('../db/captures');
    const lower = entityNames.map((n) => n.toLowerCase());
    const recent = (await listRecentCaptures(db, 30))
      .filter((c) => c.privacy_level !== 'private' && c.raw_transcript)
      .filter((c) => lower.some((n) => (c.raw_transcript || '').toLowerCase().includes(n)))
      .slice(0, 8)
      .map((c) => `- ${(c.raw_transcript || '').slice(0, 220)}`)
      .join('\n');
    if (!recent.trim()) return null; // nothing concrete to ground an insight in

    const sys = `You are LUCY, a caring personal second brain. The user keeps referencing: ${entityNames.join(', ')}.
From their recent notes below, write ONE genuinely useful, SPECIFIC, actionable insight or gentle nudge — something they might be missing, a next step to take, something to look after, or a risk worth flagging.
HARD RULES:
- Do NOT say you "connected the dots".
- Do NOT say they "keep coming back to" / "come back to" something.
- Do NOT merely restate that a topic recurs — that is useless.
- Be concrete and grounded ONLY in the notes below; never invent facts.
- First person ("I noticed…", "You might want to…"), warm, under 22 words.
- If you have nothing genuinely specific and useful to say, reply with exactly: NONE`;

    const { promptAI } = await import('../ai/openai');
    const raw = (await promptAI(sys, recent, openAIKey)).trim();
    if (!raw || /^none\b/i.test(raw) || raw.length < 8) return null;
    return raw.replace(/^["']|["']$/g, '').slice(0, 180);
  } catch {
    return null;
  }
}
