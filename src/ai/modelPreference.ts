/** In-memory model preference — persisted to the `ai_model_override` setting. Read
 *  synchronously by openai.ts/provider.ts, so it MUST be hydrated from the DB at startup
 *  (and in the headless background task) — otherwise it stays '' and falls back to the
 *  OpenAI default, sending Claude users' extraction to OpenAI with no key. */
let _model: string = '';
export const MODEL_OVERRIDE_SETTING = 'ai_model_override';

export function getPreferredModel(fallback: string): string {
  return _model || fallback;
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
