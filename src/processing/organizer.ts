import type { SQLiteDatabase } from 'expo-sqlite';
import { listAnsweredContextRequests } from '../db/contextRequests';
import { updateCaptureStructuredText } from '../db/captures';
import { listLatestExtractionEvidence, type ExtractionEvidenceRow } from '../db/extractions';
import {
  replaceKnowledgeProjection,
  type KnowledgeConfidence,
  type KnowledgeConnectionDraft,
  type KnowledgeEntityDraft,
  type KnowledgeInsightDraft,
} from '../db/knowledge';
import { listRecognizedQuestionIntentSummaries } from '../db/questions';
import type { ExtractionResult, PrivacyLevel } from '../types/extraction';
import { formatStructuredMemory } from './structuredMemory';
import { sendGuardianNotification } from './notifications';

interface EntityAccumulator {
  key: string;
  entityType: string;
  name: string;
  captureIds: Set<number>;
  latestCaptureId: number;
  privacyLevel: PrivacyLevel;
}

interface ConnectionAccumulator {
  sourceKey: string;
  relation: string;
  targetKey: string;
  captureIds: Set<number>;
  latestCaptureId: number;
  privacyLevel: PrivacyLevel;
}

const typeOrder: Record<string, number> = { project: 0, area: 1, person: 2, interest: 3 };

function normalizeEntityName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function privacyWeight(level: PrivacyLevel): number {
  return level === 'private' ? 2 : level === 'local' ? 1 : 0;
}

function mostRestricted(left: PrivacyLevel, right: PrivacyLevel): PrivacyLevel {
  return privacyWeight(left) >= privacyWeight(right) ? left : right;
}

export function confidenceFromEvidence(count: number): KnowledgeConfidence {
  return count >= 3 ? 'confirmed' : count >= 2 ? 'supported' : 'emerging';
}

function relationFor(sourceType: string, targetType: string): string {
  const pair = `${sourceType}:${targetType}`;
  if (pair === 'project:area') return 'belongs to area';
  if (pair === 'project:person') return 'involves';
  if (pair === 'project:interest') return 'relates to';
  if (pair === 'area:person') return 'includes';
  if (pair === 'area:interest') return 'relates to';
  if (pair === 'person:interest') return 'connected through';
  return 'appears with';
}

function addEntity(
  entities: Map<string, EntityAccumulator>,
  entityType: string,
  name: string,
  row: ExtractionEvidenceRow,
): EntityAccumulator | null {
  const normalized = normalizeEntityName(name);
  if (!normalized) {
    return null;
  }
  const key = `${entityType}:${normalized}`;
  const current = entities.get(key);
  if (current) {
    current.captureIds.add(row.capture_id);
    current.latestCaptureId = row.capture_id;
    current.privacyLevel = mostRestricted(current.privacyLevel, row.privacy_level);
    return current;
  }
  const created: EntityAccumulator = {
    key,
    entityType,
    name: name.trim(),
    captureIds: new Set([row.capture_id]),
    latestCaptureId: row.capture_id,
    privacyLevel: row.privacy_level,
  };
  entities.set(key, created);
  return created;
}

function addConnection(
  connections: Map<string, ConnectionAccumulator>,
  source: EntityAccumulator,
  target: EntityAccumulator,
  row: ExtractionEvidenceRow,
): void {
  const relation = relationFor(source.entityType, target.entityType);
  const key = `${source.key}|${relation}|${target.key}`;
  const current = connections.get(key);
  if (current) {
    current.captureIds.add(row.capture_id);
    current.latestCaptureId = row.capture_id;
    current.privacyLevel = mostRestricted(current.privacyLevel, row.privacy_level);
    return;
  }
  connections.set(key, {
    sourceKey: source.key,
    relation,
    targetKey: target.key,
    captureIds: new Set([row.capture_id]),
    latestCaptureId: row.capture_id,
    privacyLevel: row.privacy_level,
  });
}

export function deriveKnowledgeProjection(evidence: ExtractionEvidenceRow[]): {
  entities: KnowledgeEntityDraft[];
  connections: KnowledgeConnectionDraft[];
} {
  const entities = new Map<string, EntityAccumulator>();
  const connections = new Map<string, ConnectionAccumulator>();

  for (const row of evidence) {
    let extraction: ExtractionResult;
    try {
      extraction = JSON.parse(row.structured_json) as ExtractionResult;
    } catch {
      continue;
    }
    const captureEntities: EntityAccumulator[] = [];
    const values: Array<[string, string[]]> = [
      ['project', extraction.projects ?? []],
      ['area', extraction.areas ?? []],
      ['person', extraction.people ?? []],
      ['interest', (extraction.interests ?? []).map((interest) => interest.topic)],
    ];
    for (const [type, names] of values) {
      const distinct = new Set(names.map((name) => name.trim()).filter(Boolean));
      for (const name of distinct) {
        const entity = addEntity(entities, type, name, row);
        if (entity) {
          captureEntities.push(entity);
        }
      }
    }
    captureEntities.sort((left, right) => (typeOrder[left.entityType] ?? 9) - (typeOrder[right.entityType] ?? 9));
    for (let sourceIndex = 0; sourceIndex < captureEntities.length; sourceIndex += 1) {
      for (let targetIndex = sourceIndex + 1; targetIndex < captureEntities.length; targetIndex += 1) {
        addConnection(connections, captureEntities[sourceIndex], captureEntities[targetIndex], row);
      }
    }
  }

  return {
    entities: [...entities.values()].map((entity) => ({
      key: entity.key,
      entityType: entity.entityType,
      name: entity.name,
      evidenceCount: entity.captureIds.size,
      confidence: confidenceFromEvidence(entity.captureIds.size),
      latestCaptureId: entity.latestCaptureId,
      privacyLevel: entity.privacyLevel,
    })),
    connections: [...connections.values()]
      // Cut graph noise: a generic co-occurrence ("appears with"/"relates to") only counts
      // if two things showed up together in 2+ captures. Structural relations (belongs to
      // area, includes, involves, …) are meaningful even from a single capture, so keep them.
      .filter((connection) => {
        const generic = connection.relation === 'appears with' || connection.relation === 'relates to';
        return !generic || connection.captureIds.size >= 2;
      })
      .map((connection) => ({
        sourceKey: connection.sourceKey,
        relation: connection.relation,
        targetKey: connection.targetKey,
        evidenceCount: connection.captureIds.size,
        confidence: confidenceFromEvidence(connection.captureIds.size),
        explanation: `Seen together in ${connection.captureIds.size} remembered thought${connection.captureIds.size === 1 ? '' : 's'}.`,
        latestCaptureId: connection.latestCaptureId,
        privacyLevel: connection.privacyLevel,
      })),
  };
}

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
    // Don't notify just because a topic recurs ("you keep coming back to X — I connected the dots"
    // is noise). Generate ONE genuinely useful, grounded, actionable insight — or stay silent.
    const line = await actionableEntityInsight(db, entityNames);
    if (line) {
      try {
        await sendGuardianNotification(line, { entityNames, evidenceCount: 3, kind: 'guardian', message: line });
      } catch {
        // Non-critical.
      }
    }
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
