import type { SQLiteDatabase } from 'expo-sqlite';
import { listRecentCaptures, type CaptureRow } from '../db/captures';
import { cosineSimilarity, generateEmbedding, loadAllEmbeddings } from '../ai/embeddings';

export interface SimilarCapture {
  capture: CaptureRow;
  score: number;
}

/**
 * Find captures semantically similar to a query text.
 * Uses stored embeddings; mismatched dimensions (openai vs keyword) are handled
 * by regenerating the query embedding in the same space as stored embeddings.
 */
export async function findSimilarCaptures(
  db: SQLiteDatabase,
  query: string,
  limit = 5,
  minScore = 0.15,
): Promise<SimilarCapture[]> {
  const [allEmbeddings, recentCaptures] = await Promise.all([
    loadAllEmbeddings(db),
    listRecentCaptures(db, 100),
  ]);

  if (allEmbeddings.length === 0) return [];

  // Detect dominant model in stored embeddings
  const modelCounts: Record<string, number> = {};
  for (const e of allEmbeddings) {
    modelCounts[e.model] = (modelCounts[e.model] ?? 0) + 1;
  }
  const dominantModel = Object.entries(modelCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'keyword-256';

  // Generate query embedding — if dominant model is openai, try openai first
  const { vector: queryVec, model: queryModel } = await generateEmbedding(query);

  // Build capture map for fast lookup
  const captureMap = new Map(recentCaptures.map((c) => [c.id, c]));

  const scored: SimilarCapture[] = [];

  for (const emb of allEmbeddings) {
    const capture = captureMap.get(emb.captureId);
    if (!capture) continue;

    // Only compare embeddings of matching dimensionality / model family
    if (emb.vector.length !== queryVec.length) continue;

    const score = cosineSimilarity(queryVec, emb.vector);
    if (score >= minScore) {
      scored.push({ capture, score });
    }
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
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
  const similar = await findSimilarCaptures(db, captureText, limit + 1, 0.2);
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
