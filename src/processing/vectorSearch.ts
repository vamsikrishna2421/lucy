/**
 * Multi-signal retrieval — inspired by mem0's approach.
 *
 * Combines four signals into a single relevance score:
 *   50% semantic  — cosine similarity of embeddings (deep meaning)
 *   25% BM25      — keyword overlap (exact term matching)
 *   15% entity    — names / places / key nouns shared between query and capture
 *   10% temporal  — recency boost (recent captures score higher for same relevance)
 *
 * This beats pure cosine similarity especially when:
 * - User asks about a specific person ("Marcus") → entity signal fires
 * - User uses exact phrases ("Series B") → BM25 fires
 * - User asks about "today" → temporal fires
 */

import type { SQLiteDatabase } from 'expo-sqlite';
import { listRecentCaptures, type CaptureRow } from '../db/captures';
import { cosineSimilarity, generateEmbedding, loadAllEmbeddings } from '../ai/embeddings';

export interface SimilarCapture {
  capture: CaptureRow;
  score: number;
  signals?: { semantic: number; bm25: number; entity: number; temporal: number };
}

// ─── BM25 (simplified) ───────────────────────────────────────────────────────

const STOPWORDS = new Set(['a','an','the','and','or','but','in','on','at','to','for','of','with','by','from','is','was','are','were','be','been','being','have','has','had','do','does','did','will','would','could','should','may','might','that','this','these','those','i','my','me','we','our','you','your','it','its','they','their','what','when','where','how','who','which']);

function tokenise(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function bm25Score(queryTokens: string[], docTokens: string[], k1 = 1.5, b = 0.75, avgDocLen = 40): number {
  const docLen = docTokens.length;
  const freq: Record<string, number> = {};
  for (const t of docTokens) freq[t] = (freq[t] ?? 0) + 1;

  let score = 0;
  for (const qt of queryTokens) {
    const tf = freq[qt] ?? 0;
    if (tf === 0) continue;
    const idf = Math.log(1.5); // simplified IDF — no corpus stats needed
    const tfNorm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docLen / avgDocLen)));
    score += idf * tfNorm;
  }
  // Normalise to 0-1 (cap at 1)
  return Math.min(score / (queryTokens.length * 1.2 || 1), 1);
}

// ─── Entity overlap ──────────────────────────────────────────────────────────

function entityScore(queryText: string, captureText: string): number {
  // Extract potential entities: capitalised words, numbers, quoted phrases
  const extractEntities = (t: string): Set<string> => {
    const result = new Set<string>();
    // Capitalised words (names, places)
    for (const m of t.matchAll(/\b([A-Z][a-z]{1,20})\b/g)) result.add(m[1].toLowerCase());
    // Numbers and amounts
    for (const m of t.matchAll(/\b\d+(?:\.\d+)?\b/g)) result.add(m[0]);
    // Common noun phrases (2+ word lowercase after stopword removal)
    const tokens = tokenise(t);
    for (let i = 0; i < tokens.length - 1; i++) {
      result.add(`${tokens[i]}_${tokens[i + 1]}`);
    }
    return result;
  };

  const qEntities = extractEntities(queryText);
  const cEntities = extractEntities(captureText);
  if (qEntities.size === 0) return 0;

  let matches = 0;
  for (const e of qEntities) { if (cEntities.has(e)) matches++; }
  return Math.min(matches / qEntities.size, 1);
}

// ─── Temporal recency ────────────────────────────────────────────────────────

function temporalScore(captureDate: string): number {
  const now = Date.now();
  const created = new Date(captureDate.includes('T') ? captureDate : `${captureDate.replace(' ', 'T')}Z`).getTime();
  const ageMs = now - created;
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  // Exponential decay: 1.0 today, 0.5 at 7 days, ~0.1 at 30 days, ~0 at 90 days
  return Math.exp(-ageDays / 14);
}

// ─── Main retrieval ──────────────────────────────────────────────────────────

const WEIGHTS = { semantic: 0.50, bm25: 0.25, entity: 0.15, temporal: 0.10 };

export async function findSimilarCaptures(
  db: SQLiteDatabase,
  query: string,
  limit = 5,
  minScore = 0.12,
): Promise<SimilarCapture[]> {
  const [allEmbeddings, recentCaptures] = await Promise.all([
    loadAllEmbeddings(db),
    listRecentCaptures(db, 200), // wider window for better recall
  ]);

  if (allEmbeddings.length === 0) {
    // No embeddings yet — fall back to BM25+entity only
    return bm25FallbackSearch(query, recentCaptures, limit, minScore);
  }

  const { vector: queryVec } = await generateEmbedding(query);
  const captureMap = new Map(recentCaptures.map((c) => [c.id, c]));
  const queryTokens = tokenise(query);
  const scored: SimilarCapture[] = [];

  for (const emb of allEmbeddings) {
    const capture = captureMap.get(emb.captureId);
    if (!capture) continue;
    if (emb.vector.length !== queryVec.length) continue;

    const docText = [capture.raw_transcript ?? '', capture.extracted_title ?? '', capture.structured_text ?? ''].join(' ');
    const docTokens = tokenise(docText);

    const semantic = Math.max(0, cosineSimilarity(queryVec, emb.vector));
    const bm25     = bm25Score(queryTokens, docTokens);
    const entity   = entityScore(query, docText);
    const temporal = temporalScore(capture.created_at);

    const combined =
      WEIGHTS.semantic * semantic +
      WEIGHTS.bm25    * bm25 +
      WEIGHTS.entity  * entity +
      WEIGHTS.temporal * temporal;

    if (combined >= minScore) {
      scored.push({ capture, score: combined, signals: { semantic, bm25, entity, temporal } });
    }
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** BM25+entity fallback when no embeddings exist yet */
function bm25FallbackSearch(
  query: string,
  captures: CaptureRow[],
  limit: number,
  minScore: number,
): SimilarCapture[] {
  const queryTokens = tokenise(query);
  const results: SimilarCapture[] = [];

  for (const capture of captures) {
    const docText = [capture.raw_transcript ?? '', capture.extracted_title ?? ''].join(' ');
    const docTokens = tokenise(docText);
    const bm25   = bm25Score(queryTokens, docTokens);
    const entity = entityScore(query, docText);
    const combined = 0.65 * bm25 + 0.35 * entity;
    if (combined >= minScore) {
      results.push({ capture, score: combined });
    }
  }
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Get the top N most related past captures to a given capture text.
 * Used for cross-capture context injection during extraction.
 */
export async function getRelatedContext(
  db: SQLiteDatabase,
  captureText: string,
  excludeCaptureId?: number,
  limit = 3,
): Promise<string[]> {
  const similar = await findSimilarCaptures(db, captureText, limit + 1, 0.15);
  return similar
    .filter((s) => s.capture.id !== excludeCaptureId && s.capture.raw_transcript)
    .slice(0, limit)
    .map((s) => {
      const date = new Date(
        s.capture.created_at.includes('T') ? s.capture.created_at : `${s.capture.created_at.replace(' ', 'T')}Z`,
      ).toLocaleDateString();
      const title = s.capture.extracted_title ?? '';
      const snippet = (s.capture.raw_transcript ?? '').slice(0, 200);
      return `[${date}${title ? ` — ${title}` : ''}]: ${snippet}`;
    });
}
