/** In-memory model preference — persisted to the `ai_model_override` setting. Read
 *  synchronously by openai.ts/provider.ts, so it MUST be hydrated from the DB at startup
 *  (and in the headless background task) — otherwise it stays '' and falls back to the
 *  OpenAI default, sending Claude users' extraction to OpenAI with no key. */
let _model: string = '';
export const MODEL_OVERRIDE_SETTING = 'ai_model_override';

// The app must NEVER silently default to an OpenAI model (user directive). When there's no saved
// override, route to Claude Sonnet — not gpt-4o-mini. The OpenAI default is only ever used if the
// user EXPLICITLY picks an OpenAI model in Settings (which sets _model).
export const DEFAULT_MODEL = 'claude-sonnet-4-6';

export function getPreferredModel(fallback: string): string {
  if (_model) return _model;                       // user's explicit choice always wins
  if (fallback && fallback.startsWith('claude-')) return fallback; // caller already wants Claude
  return DEFAULT_MODEL;                            // never fall back to an OpenAI model
}

export function setPreferredModel(model: string): void {
  _model = model;
}

// ─── Per-task model routing (cost control) ──────────────────────────────────────
// The #1 cost lever: route each task to the CHEAPEST model that does it well, instead of running
// everything on the user's single selected (often Sonnet/Opus) model.
//   • cheap tier — frequent, mechanical work (per-note extraction, topic classification, journal
//     segmentation, daily summary). Haiku / gpt-4o-mini handle these well.
//   • mid tier   — the rare cross-domain insight engine (brain pulse, reflection). Sonnet / gpt-4o.
//   • chat       — interactive Ask / voice assistant: honor the user's EXACT pick (the only place a
//     user-selected Opus is used). Background tasks never use Opus.
// Stays on the user's provider (Claude vs OpenAI); on-device / unknown models pass through unchanged.
export type AiTask = 'extraction' | 'classify' | 'segment' | 'summary' | 'insight' | 'chat';

const CLAUDE_TIER = { cheap: 'claude-haiku-4-5-20251001', mid: 'claude-sonnet-4-6' } as const;
const OPENAI_TIER = { cheap: 'gpt-4o-mini', mid: 'gpt-4o' } as const;

export function modelForTask(task: AiTask, fallback: string = DEFAULT_MODEL): string {
  const selected = getPreferredModel(fallback);
  if (task === 'chat') return selected;                       // interactive — honor the user's pick
  const tier: 'cheap' | 'mid' = task === 'insight' ? 'mid' : 'cheap';
  if (selected.startsWith('claude-')) return CLAUDE_TIER[tier];
  if (/^(gpt|o[0-9]|chatgpt)/i.test(selected)) return OPENAI_TIER[tier];
  return selected;                                            // on-device / unknown → leave as-is
}

/** Load the saved model preference into memory. Call at app startup AND before background
 *  processing, so every context (foreground/background/headless) routes to the right provider. */
export async function loadPreferredModel(db: import('expo-sqlite').SQLiteDatabase): Promise<void> {
  try {
    const { getSetting } = await import('../db/settings');
    const saved = (await getSetting(db, MODEL_OVERRIDE_SETTING))?.trim();
    if (saved) _model = saved;
  } catch { /* keep current/fallback */ }
}
