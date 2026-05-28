import type { SQLiteDatabase } from 'expo-sqlite';
import type { PrivacyLevel } from '../types/extraction';

export type KnowledgeConfidence = 'emerging' | 'supported' | 'confirmed';

export interface KnowledgeEntityDraft {
  key: string;
  entityType: string;
  name: string;
  evidenceCount: number;
  confidence: KnowledgeConfidence;
  latestCaptureId: number;
  privacyLevel: PrivacyLevel;
}

export interface KnowledgeConnectionDraft {
  sourceKey: string;
  relation: string;
  targetKey: string;
  evidenceCount: number;
  confidence: KnowledgeConfidence;
  explanation: string;
  latestCaptureId: number;
  privacyLevel: PrivacyLevel;
}

export interface KnowledgeInsightDraft {
  key: string;
  type: string;
  title: string;
  detail: string;
  evidenceCount: number;
  confidence: KnowledgeConfidence;
  privacyLevel: PrivacyLevel;
  observedAt?: string | null;
}

export interface KnowledgeEntityRow {
  id: number;
  entity_type: string;
  name: string;
  evidence_count: number;
  confidence: KnowledgeConfidence;
  privacy_level: PrivacyLevel;
}

export interface KnowledgeConnectionRow {
  id: number;
  relation: string;
  evidence_count: number;
  confidence: KnowledgeConfidence;
  privacy_level: PrivacyLevel;
  source_name: string;
  source_type: string;
  target_name: string;
  target_type: string;
  explanation: string;
}

export interface KnowledgeInsightRow {
  id: number;
  insight_type: string;
  title: string;
  detail: string;
  evidence_count: number;
  confidence: KnowledgeConfidence;
  privacy_level: PrivacyLevel;
}

export interface OrganizationRunRow {
  id: number;
  created_at: string;
  trigger: string;
  summary: string;
  entity_count: number;
  connection_count: number;
  insight_count: number;
}

export async function replaceKnowledgeProjection(
  db: SQLiteDatabase,
  entities: KnowledgeEntityDraft[],
  connections: KnowledgeConnectionDraft[],
  insights: KnowledgeInsightDraft[],
  trigger: string,
  summary: string,
): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.execAsync('DELETE FROM knowledge_connections; DELETE FROM knowledge_entities; DELETE FROM knowledge_insights;');
    const ids = new Map<string, number>();
    for (const entity of entities) {
      const result = await db.runAsync(
        `INSERT INTO knowledge_entities
         (entity_type, name, normalized_name, evidence_count, confidence, latest_capture_id, privacy_level)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        entity.entityType,
        entity.name,
        entity.key.split(':').slice(1).join(':'),
        entity.evidenceCount,
        entity.confidence,
        entity.latestCaptureId,
        entity.privacyLevel,
      );
      ids.set(entity.key, result.lastInsertRowId);
    }
    for (const connection of connections) {
      const sourceId = ids.get(connection.sourceKey);
      const targetId = ids.get(connection.targetKey);
      if (!sourceId || !targetId) {
        continue;
      }
      await db.runAsync(
        `INSERT INTO knowledge_connections
         (source_entity_id, relation, target_entity_id, evidence_count, confidence, explanation, latest_capture_id, privacy_level)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        sourceId,
        connection.relation,
        targetId,
        connection.evidenceCount,
        connection.confidence,
        connection.explanation,
        connection.latestCaptureId,
        connection.privacyLevel,
      );
    }
    for (const insight of insights) {
      await db.runAsync(
        `INSERT INTO knowledge_insights
         (insight_key, insight_type, title, detail, evidence_count, confidence, privacy_level, observed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))`,
        insight.key,
        insight.type,
        insight.title,
        insight.detail,
        insight.evidenceCount,
        insight.confidence,
        insight.privacyLevel,
        insight.observedAt ?? null,
      );
    }
    await db.runAsync(
      `INSERT INTO organization_runs (trigger, summary, entity_count, connection_count, insight_count)
       VALUES (?, ?, ?, ?, ?)`,
      trigger,
      summary,
      entities.length,
      connections.length,
      insights.length,
    );
  });
}

export async function listKnowledgeEntities(db: SQLiteDatabase): Promise<KnowledgeEntityRow[]> {
  return db.getAllAsync<KnowledgeEntityRow>(
    `SELECT * FROM knowledge_entities
     ORDER BY CASE confidence WHEN 'confirmed' THEN 0 WHEN 'supported' THEN 1 ELSE 2 END,
     evidence_count DESC, name ASC`,
  );
}

export async function listKnowledgeConnections(db: SQLiteDatabase): Promise<KnowledgeConnectionRow[]> {
  return db.getAllAsync<KnowledgeConnectionRow>(
    `SELECT c.*, source.name AS source_name, source.entity_type AS source_type,
       target.name AS target_name, target.entity_type AS target_type
     FROM knowledge_connections c
     INNER JOIN knowledge_entities source ON source.id = c.source_entity_id
     INNER JOIN knowledge_entities target ON target.id = c.target_entity_id
     ORDER BY CASE c.confidence WHEN 'confirmed' THEN 0 WHEN 'supported' THEN 1 ELSE 2 END,
     c.evidence_count DESC, c.id DESC`,
  );
}

export async function listKnowledgeInsights(db: SQLiteDatabase): Promise<KnowledgeInsightRow[]> {
  return db.getAllAsync<KnowledgeInsightRow>(
    `SELECT * FROM knowledge_insights
     ORDER BY CASE confidence WHEN 'confirmed' THEN 0 WHEN 'supported' THEN 1 ELSE 2 END,
     observed_at DESC, id DESC`,
  );
}

export async function getLatestOrganizationRun(db: SQLiteDatabase): Promise<OrganizationRunRow | null> {
  return db.getFirstAsync<OrganizationRunRow>(
    'SELECT * FROM organization_runs ORDER BY created_at DESC, id DESC LIMIT 1',
  );
}
