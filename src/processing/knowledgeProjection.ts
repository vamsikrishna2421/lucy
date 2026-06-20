/**
 * Knowledge-graph PROJECTION — pure + deterministic + unit-tested (no DB, no native imports).
 * Turns the latest per-capture extractions into entities + honest co-occurrence connections.
 *
 * Honesty principle: every edge is pure CO-OCCURRENCE (two entities that turned up in the same
 * capture). We never extract the *nature* of a relationship, so we never assert one — no "involves",
 * "belongs to area", "connected through". The entity TYPES (which ARE extracted) carry the structure,
 * and strength is conveyed by evidence count / confidence.
 */
import type { KnowledgeConfidence, KnowledgeConnectionDraft, KnowledgeEntityDraft } from '../db/knowledge';
import type { ExtractionEvidenceRow } from '../db/extractions';
import type { ExtractionResult, PrivacyLevel } from '../types/extraction';

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

// Every knowledge-graph edge is pure CO-OCCURRENCE — see the file header. Labelled honestly; the
// entity TYPES carry the structure, strength is conveyed by evidence count / confidence.
const COOCCURRENCE_RELATION = 'appears with';

// Type pairs that are structurally meaningful even from a single shared capture (kept at 1+ evidence);
// looser pairings (interest links, same-type) need 2+ co-occurrences so the graph doesn't turn into a
// hairball. Based on the real, extracted entity types — not on any guessed relationship verb.
const STRUCTURAL_PAIRS = new Set(['area:project', 'person:project', 'area:person', 'interest:person']);
function isStructuralPair(sourceType: string, targetType: string): boolean {
  return STRUCTURAL_PAIRS.has([sourceType, targetType].sort().join(':'));
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
  const relation = COOCCURRENCE_RELATION;
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
      // Cut graph noise: a loose pairing only becomes an edge once two things showed up together in
      // 2+ captures. Structurally meaningful TYPE pairs (project↔area, project↔person, area↔person,
      // person↔interest) are kept even from a single capture. (Types are extracted from the keys.)
      .filter((connection) => {
        const sourceType = connection.sourceKey.split(':')[0];
        const targetType = connection.targetKey.split(':')[0];
        return isStructuralPair(sourceType, targetType) || connection.captureIds.size >= 2;
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
