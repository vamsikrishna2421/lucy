/**
 * Learned Profile — durable, auto-evolving facts LUCY has learned about the user
 * (preferences, habits, traits, routines, goals, corrections). Built by the daily
 * reflection pass and by explicit feedback, injected into every AI call via
 * buildUserContextPrefix, and surfaced in a viewer the user can prune.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

export type LearnedCategory = 'preference' | 'habit' | 'trait' | 'routine' | 'goal' | 'relationship' | 'correction';
export type LearnedConfidence = 'emerging' | 'supported' | 'confirmed';
export type LearnedSource = 'reflection' | 'feedback';

export interface LearnedFactRow {
  id: number;
  category: LearnedCategory;
  statement: string;
  normalized: string;
  confidence: LearnedConfidence;
  evidence_count: number;
  source: LearnedSource;
  created_at: string;
  updated_at: string;
  last_seen_at: string;
}

/** Normalize a statement for dedup: lowercase, strip punctuation, collapse whitespace. */
export function normalizeStatement(statement: string): string {
  return statement.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

const NEXT_CONFIDENCE: Record<LearnedConfidence, LearnedConfidence> = {
  emerging: 'supported',
  supported: 'confirmed',
  confirmed: 'confirmed',
};

/**
 * Inserts a new learned fact or reinforces an existing one (by normalized statement):
 * bumps evidence_count, raises confidence one step, refreshes last_seen_at.
 * Feedback-sourced facts are stated directly by the user → start confirmed.
 */
export async function upsertLearnedFact(
  db: SQLiteDatabase,
  category: LearnedCategory,
  statement: string,
  source: LearnedSource = 'reflection',
): Promise<void> {
  const text = statement.trim();
  if (text.length < 4) return;
  const normalized = normalizeStatement(text);
  if (!normalized) return;

  const existing = await db.getFirstAsync<LearnedFactRow>(
    'SELECT * FROM learned_facts WHERE normalized = ?',
    normalized,
  );
  if (existing) {
    const nextConf = source === 'feedback' ? 'confirmed' : NEXT_CONFIDENCE[existing.confidence];
    await db.runAsync(
      `UPDATE learned_facts SET evidence_count = evidence_count + 1, confidence = ?,
         statement = ?, category = ?, updated_at = CURRENT_TIMESTAMP, last_seen_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      nextConf, text, category, existing.id,
    );
    return;
  }
  await db.runAsync(
    `INSERT INTO learned_facts (category, statement, normalized, confidence, evidence_count, source)
     VALUES (?, ?, ?, ?, 1, ?)`,
    category, text, normalized, source === 'feedback' ? 'confirmed' : 'emerging', source,
  );
}

/** Lists learned facts, strongest first (confirmed → supported → emerging, then recency). */
export async function listLearnedFacts(db: SQLiteDatabase, limit = 100): Promise<LearnedFactRow[]> {
  return db.getAllAsync<LearnedFactRow>(
    `SELECT * FROM learned_facts
     ORDER BY CASE confidence WHEN 'confirmed' THEN 0 WHEN 'supported' THEN 1 ELSE 2 END,
       evidence_count DESC, updated_at DESC
     LIMIT ?`,
    limit,
  );
}

/** Top facts worth injecting into a prompt — only supported/confirmed, capped. */
export async function getInjectableLearnedFacts(db: SQLiteDatabase, limit = 12): Promise<string[]> {
  const rows = await db.getAllAsync<{ statement: string }>(
    `SELECT statement FROM learned_facts
     WHERE confidence IN ('supported','confirmed')
     ORDER BY CASE confidence WHEN 'confirmed' THEN 0 ELSE 1 END, evidence_count DESC, updated_at DESC
     LIMIT ?`,
    limit,
  );
  return rows.map((r) => r.statement);
}

export async function deleteLearnedFact(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM learned_facts WHERE id = ?', id);
}

/** Drops low-confidence facts not reinforced in ~45 days, so stale guesses fade out. */
export async function decayStaleLearnedFacts(db: SQLiteDatabase): Promise<void> {
  await db.runAsync(
    `DELETE FROM learned_facts
     WHERE confidence = 'emerging' AND source = 'reflection'
       AND last_seen_at < datetime('now', '-45 days')`,
  );
}
