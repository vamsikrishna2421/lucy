import type { SQLiteDatabase } from 'expo-sqlite';
import { getRemoteAccessState, getRemoteOpenAIKey } from './remoteAccess';
import { OPENAI_EMBED_MODEL, KEYWORD_EMBED_MODEL } from './embeddingModel';

export type EmbeddingVector = number[];

// ─── Cosine similarity ───────────────────────────────────────────────────────

export function cosineSimilarity(a: EmbeddingVector, b: EmbeddingVector): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ─── OpenAI embedding ─────────────────────────────────────────────────────────

async function openAIEmbed(text: string, apiKey: string): Promise<EmbeddingVector | null> {
  try {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: text.slice(0, 8000), dimensions: 512 }),
    });
    if (!response.ok) return null;
    const json = (await response.json()) as { data?: Array<{ embedding: number[] }> };
    return json.data?.[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

// ─── Keyword fingerprint fallback (works offline) ────────────────────────────
// Produces a 256-dim sparse vector using term hashing (no external calls needed).

function keywordFingerprint(text: string): EmbeddingVector {
  const DIM = 256;
  const vec = new Array<number>(DIM).fill(0);
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);

  for (const word of words) {
    // FNV-1a hash → index into vector
    let h = 2166136261;
    for (let i = 0; i < word.length; i++) {
      h ^= word.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    const idx = h % DIM;
    vec[idx] += 1;
  }

  // L2 normalise
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  if (norm > 0) {
    for (let i = 0; i < DIM; i++) vec[i] /= norm;
  }
  return vec;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function generateEmbedding(text: string): Promise<{ vector: EmbeddingVector; model: string }> {
  const remote = await getRemoteAccessState();
  if (remote.enabled && remote.hasKey) {
    const apiKey = await getRemoteOpenAIKey();
    if (apiKey) {
      const vec = await openAIEmbed(text, apiKey);
      if (vec) return { vector: vec, model: OPENAI_EMBED_MODEL };
    }
  }
  return { vector: keywordFingerprint(text), model: KEYWORD_EMBED_MODEL };
}

/** The model generateEmbedding WOULD use right now (without embedding any text). Lets retrieval detect
 *  rows produced by a different model after the user toggles remote AI on/off. */
export async function currentEmbeddingModel(): Promise<string> {
  const remote = await getRemoteAccessState();
  if (remote.enabled && remote.hasKey && (await getRemoteOpenAIKey())) return OPENAI_EMBED_MODEL;
  return KEYWORD_EMBED_MODEL;
}

export async function storeEmbedding(
  db: SQLiteDatabase,
  captureId: number,
  text: string,
): Promise<void> {
  try {
    const { vector, model } = await generateEmbedding(text);
    await db.runAsync(
      `INSERT OR REPLACE INTO capture_embeddings (capture_id, embedding, model) VALUES (?, ?, ?)`,
      captureId,
      JSON.stringify(vector),
      model,
    );
  } catch { /* non-critical */ }
}

export async function loadAllEmbeddings(
  db: SQLiteDatabase,
): Promise<Array<{ captureId: number; vector: EmbeddingVector; model: string }>> {
  const rows = await db.getAllAsync<{ capture_id: number; embedding: string; model: string }>(
    'SELECT capture_id, embedding, model FROM capture_embeddings',
  );
  return rows.map((row) => ({
    captureId: row.capture_id,
    vector: JSON.parse(row.embedding) as EmbeddingVector,
    model: row.model,
  }));
}

/** Load embeddings for a SPECIFIC set of captures. Retrieval only scores the recent window, so loading
 *  the whole table every search is wasteful — this scopes the read (chunked to stay under SQLite's
 *  variable limit) and skips any corrupt rows. */
export async function loadEmbeddingsFor(
  db: SQLiteDatabase,
  captureIds: number[],
): Promise<Array<{ captureId: number; vector: EmbeddingVector; model: string }>> {
  if (captureIds.length === 0) return [];
  const out: Array<{ captureId: number; vector: EmbeddingVector; model: string }> = [];
  const CHUNK = 400;
  for (let i = 0; i < captureIds.length; i += CHUNK) {
    const ids = captureIds.slice(i, i + CHUNK);
    const placeholders = ids.map(() => '?').join(',');
    const rows = await db.getAllAsync<{ capture_id: number; embedding: string; model: string }>(
      `SELECT capture_id, embedding, model FROM capture_embeddings WHERE capture_id IN (${placeholders})`,
      ...ids,
    );
    for (const row of rows) {
      try {
        out.push({ captureId: row.capture_id, vector: JSON.parse(row.embedding) as EmbeddingVector, model: row.model });
      } catch { /* skip a corrupt embedding row */ }
    }
  }
  return out;
}

/** Re-embed captures whose stored embedding came from a DIFFERENT model than the current one, so old
 *  memories stay searchable after the user switches embedding models (remote ↔ on-device). Bounded and
 *  safe to fire-and-forget; a handful per search means the store converges over a few searches. */
export async function reembedStaleCaptures(
  db: SQLiteDatabase,
  stale: Array<{ captureId: number; text: string }>,
  limit = 15,
): Promise<number> {
  let healed = 0;
  for (const { captureId, text } of stale.slice(0, limit)) {
    if (!text.trim()) continue;
    await storeEmbedding(db, captureId, text); // INSERT OR REPLACE with the CURRENT model
    healed += 1;
  }
  return healed;
}
