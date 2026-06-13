/**
 * Builds the comprehensive "who this person is" memory export (v2.0).
 * Shared by Settings → Export as JSON and the LAN companion server (/api/memory).
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import { getUserProfile } from '../db/userProfile';

export interface MemoryExport {
  exported_at: string;
  version: string;
  profile: { name?: string; about?: string; languages?: string[] };
  learned_profile: unknown[];
  knowledge: { entities: unknown[]; connections: unknown[]; insights: unknown[] };
  mood_entries: unknown[];
  captures: unknown[];
  todos: unknown[];
  expenses: unknown[];
  reminders: unknown[];
  ideas: unknown[];
  people: unknown[];
  open_loops: unknown[];
  follow_ups: unknown[];
}

export async function buildMemoryExport(db: SQLiteDatabase): Promise<MemoryExport> {
  const safe = async (sql: string): Promise<unknown[]> => {
    try { return await db.getAllAsync(sql); } catch { return []; }
  };
  const [
    captures, todos, expenses, reminders, ideas, people, openLoops, followUps,
    learnedFacts, knowledgeEntities, knowledgeConnections, knowledgeInsights, moodEntries, profile,
  ] = await Promise.all([
    safe('SELECT * FROM captures ORDER BY created_at DESC'),
    safe('SELECT * FROM todos ORDER BY created_at DESC'),
    safe('SELECT * FROM expenses ORDER BY created_at DESC'),
    safe('SELECT * FROM reminders ORDER BY created_at DESC'),
    safe('SELECT * FROM ideas ORDER BY created_at DESC'),
    safe('SELECT * FROM people ORDER BY name ASC'),
    safe('SELECT * FROM open_loops ORDER BY created_at DESC'),
    safe('SELECT * FROM follow_ups ORDER BY created_at DESC'),
    safe("SELECT * FROM learned_facts ORDER BY CASE confidence WHEN 'confirmed' THEN 0 WHEN 'supported' THEN 1 ELSE 2 END, evidence_count DESC"),
    safe('SELECT * FROM knowledge_entities ORDER BY evidence_count DESC'),
    safe(`SELECT c.*, s.name AS source_name, t.name AS target_name FROM knowledge_connections c
          LEFT JOIN knowledge_entities s ON s.id = c.source_entity_id
          LEFT JOIN knowledge_entities t ON t.id = c.target_entity_id ORDER BY c.evidence_count DESC`),
    safe('SELECT * FROM knowledge_insights ORDER BY observed_at DESC'),
    safe('SELECT * FROM mood_entries ORDER BY id DESC LIMIT 500'),
    getUserProfile(db),
  ]);

  return {
    exported_at: new Date().toISOString(),
    version: '2.0',
    profile: { name: profile.name, about: profile.about, languages: profile.languages },
    learned_profile: learnedFacts,
    knowledge: { entities: knowledgeEntities, connections: knowledgeConnections, insights: knowledgeInsights },
    mood_entries: moodEntries,
    captures,
    todos,
    expenses,
    reminders,
    ideas,
    people,
    open_loops: openLoops,
    follow_ups: followUps,
  };
}
