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

const FACT_STOPWORDS = new Set(['the', 'and', 'for', 'with', 'their', 'they', 'them', 'that', 'this', 'about', 'often', 'tends', 'around', 'user', 'usually', 'typically', 'into', 'over', 'through', 'rather', 'than', 'have', 'has', 'are', 'was', 'were', 'who', 'which', 'when', 'while']);
function contentTokens(s: string): Set<string> {
  return new Set(normalizeStatement(s).split(' ').filter((w) => w.length > 3 && !FACT_STOPWORDS.has(w)));
}
/**
 * Symmetric Jaccard token-overlap (0-1) so rephrased facts are recognised as the same fact, WITHOUT
 * the old over-merge bug: the previous `m / min(|a|,|b|)` divided by the smaller set, so a short fact
 * ("likes coffee") whose tokens appear inside a longer unrelated fact scored 1.0 and got merged.
 * Jaccard (m / union) is symmetric, and we refuse to fuzzy-compare facts with <2 content tokens
 * (they can only match on exact normalized text) — those are too short to judge safely.
 */
function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size < 2 || b.size < 2) return 0;
  let m = 0; for (const t of a) if (b.has(t)) m++;
  const union = a.size + b.size - m;
  return union === 0 ? 0 : m / union;
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
 * Returns true ONLY when a genuinely new fact was inserted (so callers can report an honest
 * "learned N new things" instead of counting reinforcements of facts already known).
 */
export async function upsertLearnedFact(
  db: SQLiteDatabase,
  category: LearnedCategory,
  statement: string,
  source: LearnedSource = 'reflection',
): Promise<boolean> {
  const text = statement.trim();
  if (text.length < 4) return false;
  const normalized = normalizeStatement(text);
  if (!normalized) return false;

  // Find a match: exact normalized first, else a fuzzy token-overlap match (the LLM
  // rephrases facts each run, so exact-only dedup would let near-duplicates pile up
  // and never escalate past "emerging").
  let existing = await db.getFirstAsync<LearnedFactRow>('SELECT * FROM learned_facts WHERE normalized = ?', normalized);
  if (!existing) {
    const tk = contentTokens(text);
    const all = await db.getAllAsync<LearnedFactRow>('SELECT * FROM learned_facts');
    let best: LearnedFactRow | null = null; let bestSim = 0;
    for (const row of all) {
      const sim = similarity(tk, contentTokens(row.statement));
      if (sim > bestSim) { bestSim = sim; best = row; }
    }
    // Same-category gate + Jaccard floor: only merge a rephrasing of the SAME kind of fact, never
    // collapse two distinct facts that happen to share words across categories.
    if (best && bestSim >= 0.6 && best.category === category) existing = best;
  }
  if (existing) {
    const nextConf = source === 'feedback' ? 'confirmed' : NEXT_CONFIDENCE[existing.confidence];
    await db.runAsync(
      `UPDATE learned_facts SET evidence_count = evidence_count + 1, confidence = ?,
         statement = ?, normalized = ?, category = ?, updated_at = CURRENT_TIMESTAMP, last_seen_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      nextConf, text, normalized, category, existing.id,
    );
    return false; // reinforced an existing fact, not a new one
  }
  await db.runAsync(
    `INSERT INTO learned_facts (category, statement, normalized, confidence, evidence_count, source)
     VALUES (?, ?, ?, ?, 1, ?)`,
    category, text, normalized, source === 'feedback' ? 'confirmed' : 'emerging', source,
  );
  return true;
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

/** Top facts to inject into a prompt — all confidences (so the profile influences the
 *  AI from day one), strongest first, capped. Reinforced/confirmed facts outrank fresh
 *  guesses; the user can prune wrong ones in the viewer. */
export async function getInjectableLearnedFacts(db: SQLiteDatabase, limit = 12): Promise<string[]> {
  const rows = await db.getAllAsync<{ statement: string }>(
    `SELECT statement FROM learned_facts
     ORDER BY CASE confidence WHEN 'confirmed' THEN 0 WHEN 'supported' THEN 1 ELSE 2 END,
       evidence_count DESC, updated_at DESC
     LIMIT ?`,
    limit,
  );
  return rows.map((r) => r.statement);
}

export async function deleteLearnedFact(db: SQLiteDatabase, id: number): Promise<boolean> {
  const res = await db.runAsync('DELETE FROM learned_facts WHERE id = ?', id);
  return res.changes > 0;
}

const CONF_RANK: Record<LearnedConfidence, number> = { confirmed: 0, supported: 1, emerging: 2 };

/**
 * Collapses near-duplicate learned facts that piled up (the LLM rephrases the same fact each
 * reflection — e.g. the data-engineering role or the ~7:45 morning routine stated 3 ways). Folds
 * each weaker duplicate into the strongest matching primary (sums evidence), then deletes it.
 * Returns the number merged away. Conservative threshold to avoid merging distinct facts.
 */
export async function dedupLearnedFacts(db: SQLiteDatabase, threshold = 0.6): Promise<number> {
  const all = await db.getAllAsync<LearnedFactRow>('SELECT * FROM learned_facts');
  // Strongest first so weaker rephrasings fold into the confirmed/most-evidenced primary.
  all.sort((a, b) => (CONF_RANK[a.confidence] - CONF_RANK[b.confidence]) || (b.evidence_count - a.evidence_count) || (a.id - b.id));
  const kept: Array<{ row: LearnedFactRow; tokens: Set<string> }> = [];
  const drops: Array<{ id: number; into: number; evidence: number }> = [];
  for (const row of all) {
    const tk = contentTokens(row.statement);
    // Only merge within the same category (symmetric Jaccard ≥ threshold) so distinct facts that
    // share a few words across categories are never collapsed.
    const match = kept.find((k) => k.row.category === row.category && similarity(tk, k.tokens) >= threshold);
    if (match) drops.push({ id: row.id, into: match.row.id, evidence: row.evidence_count });
    else kept.push({ row, tokens: tk });
  }
  for (const d of drops) {
    await db.runAsync('UPDATE learned_facts SET evidence_count = evidence_count + ? WHERE id = ?', d.evidence, d.into);
    await db.runAsync('DELETE FROM learned_facts WHERE id = ?', d.id);
  }
  return drops.length;
}

/**
 * Drops only VERY old, low-confidence reflection GUESSES (default 180 days). These are emerging,
 * LLM-inferred facts (not user-stated), so clearing ancient unreinforced ones avoids corrupting the
 * prompt — but 45 days was too aggressive and risked forgetting real-but-quiet traits. Never touches
 * 'supported'/'confirmed' facts or anything the user explicitly told LUCY.
 */
export async function decayStaleLearnedFacts(db: SQLiteDatabase): Promise<void> {
  await db.runAsync(
    `DELETE FROM learned_facts
     WHERE confidence = 'emerging' AND source = 'reflection'
       AND last_seen_at < datetime('now', '-180 days')`,
  );
}
