/* Pure tests for embedding-model staleness. Run: npx tsx tests/embeddingModel.ts */
import { isEmbeddingStale, OPENAI_EMBED_MODEL, KEYWORD_EMBED_MODEL } from '../src/ai/embeddingModel';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean) { if (cond) { pass++; } else { fail++; console.error('FAIL:', name); } }

// Same model + same dim → fresh.
ok('openai vs openai (512) → fresh', !isEmbeddingStale(OPENAI_EMBED_MODEL, 512, OPENAI_EMBED_MODEL, 512));
ok('keyword vs keyword (256) → fresh', !isEmbeddingStale(KEYWORD_EMBED_MODEL, 256, KEYWORD_EMBED_MODEL, 256));

// Model switched (the real toggle-remote-AI case) → stale, both directions.
ok('keyword stored, openai current → stale', isEmbeddingStale(KEYWORD_EMBED_MODEL, 256, OPENAI_EMBED_MODEL, 512));
ok('openai stored, keyword current → stale', isEmbeddingStale(OPENAI_EMBED_MODEL, 512, KEYWORD_EMBED_MODEL, 256));

// Same model name but a dimension drift (e.g. config change) → still stale (can't cosine-compare).
ok('same model, different dim → stale', isEmbeddingStale(OPENAI_EMBED_MODEL, 1536, OPENAI_EMBED_MODEL, 512));

// Unknown/empty model rows are treated as stale against any current model.
ok('empty stored model → stale', isEmbeddingStale('', 0, KEYWORD_EMBED_MODEL, 256));

console.log(`\nembeddingModel: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
