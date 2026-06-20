/**
 * Embedding-model identity + staleness — pure, no native imports, unit-tested.
 *
 * Two embedding models exist: a remote OpenAI one and an on-device keyword fingerprint. They have
 * different dimensions, so when the user toggles remote AI the *query* gets embedded with the new model
 * while older captures still carry the old model's vectors. Retrieval must detect that mismatch and
 * lazily re-embed, otherwise those memories silently fall out of semantic search.
 */
export const OPENAI_EMBED_MODEL = 'openai-3-small-512';
export const KEYWORD_EMBED_MODEL = 'keyword-256';

/** A stored embedding is stale (can't be compared to the current query vector) when it came from a
 *  different model OR has a different dimensionality than what the current model produces. */
export function isEmbeddingStale(embModel: string, embDim: number, currentModel: string, currentDim: number): boolean {
  return embModel !== currentModel || embDim !== currentDim;
}
