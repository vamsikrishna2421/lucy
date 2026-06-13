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
    connections: [...connections.values()].map((connection) => ({
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
  const insights: KnowledgeInsightDraft[] = [
    ...clarified.map((context) => ({
      key: `clarification:${context.id}`,
      type: 'clarification',
      title: `Clarified memory: ${context.snippet?.trim() || 'Additional context'}`,
      detail: context.answer_text?.trim() || 'Context was provided.',
      evidenceCount: 1,
      confidence: 'confirmed' as const,
      privacyLevel: 'private' as const,
      observedAt: context.answered_at,
    })),
    ...questionIntents.map((intent) => ({
      key: `question-intent:${intent.intent}`,
      type: 'requested_view',
      title: intent.intent === 'today_pending_tasks_and_deadlines'
        ? 'Useful view: today tasks and deadlines'
        : 'Useful view requested',
      detail: `Asked ${intent.count} time${intent.count === 1 ? '' : 's'}. LUCY can prioritize this view during future organization.`,
      evidenceCount: intent.count,
      confidence: confidenceFromEvidence(intent.count),
      privacyLevel: 'private' as const,
      observedAt: intent.last_asked_at,
    })),
  ];
  const summary = `Organized ${evidence.length} remembered thought${evidence.length === 1 ? '' : 's'} into ${projection.entities.length} entities, ${projection.connections.length} connections, and ${insights.length} insights.`;
  await replaceKnowledgeProjection(db, projection.entities, projection.connections, insights, trigger, summary);

  const freshlyConfirmed = projection.entities.filter(
    (entity) => entity.confidence === 'confirmed' && entity.evidenceCount === 3,
  );
  if (freshlyConfirmed.length > 0) {
    const entityNames = freshlyConfirmed.map((entity) => entity.name);
    const names = entityNames.slice(0, 2).join(', ');
    const extra = entityNames.length > 2 ? ` and ${entityNames.length - 2} more` : '';
    try {
      await sendGuardianNotification(
        `you keep coming back to ${names}${extra} — I connected the dots`,
        { entityNames, evidenceCount: 3 },
      );
    } catch {
      // Non-critical.
    }
  }

  // Daily "learns about you" reflection — piggybacks the periodic background pass.
  // Self-gated to once/day and never throws, so it's safe to fire-and-forget.
  if (trigger === 'background') {
    void import('./reflectOnUser').then(({ reflectOnUser }) => reflectOnUser(db)).catch(() => {});
  }
}
