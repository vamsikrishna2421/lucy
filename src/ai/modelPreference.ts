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

/** Load the saved model preference into memory. Call at app startup AND before background
 *  processing, so every context (foreground/background/headless) routes to the right provider. */
export async function loadPreferredModel(db: import('expo-sqlite').SQLiteDatabase): Promise<void> {
  try {
    const { getSetting } = await import('../db/settings');
    const saved = (await getSetting(db, MODEL_OVERRIDE_SETTING))?.trim();
    if (saved) _model = saved;
  } catch { /* keep current/fallback */ }
}
