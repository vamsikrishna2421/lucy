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

// ─── Per-role model routing (cost control + BYOK customization) ──────────────────
// Every task maps to one of three ROLES; each role has a model. Defaults are cost-optimal (user
// directive: Haiku for routine work, Sonnet for synthesis, NEVER Opus by default). BYOK users may
// change any role; a managed-token service LOCKS roles to these defaults so cost stays controlled.
export type AiTask = 'extraction' | 'classify' | 'segment' | 'summary' | 'insight' | 'chat';
export type ModelRole = 'capture' | 'insight' | 'assistant';
export type TokenMode = 'byok' | 'managed';

// capture = per-note structuring + organizing (frequent, mechanical); insight = cross-domain synthesis
// (rare); assistant = interactive Ask/voice (the user's conversation partner).
const DEFAULT_ROLE_MODELS: Record<ModelRole, string> = {
  capture:   'claude-haiku-4-5-20251001',
  insight:   'claude-sonnet-4-6',
  assistant: 'claude-sonnet-4-6',
};
const TASK_ROLE: Record<AiTask, ModelRole> = {
  extraction: 'capture', classify: 'capture', segment: 'capture', summary: 'capture',
  insight: 'insight', chat: 'assistant',
};
export const ROLE_MODEL_SETTING: Record<ModelRole, string> = {
  capture: 'model_role_capture', insight: 'model_role_insight', assistant: 'model_role_assistant',
};
export const TOKEN_MODE_SETTING = 'ai_token_mode';

let _roleOverrides: Partial<Record<ModelRole, string>> = {};
let _tokenMode: TokenMode = 'byok';

export function getTokenMode(): TokenMode { return _tokenMode; }
export function getDefaultRoleModels(): Record<ModelRole, string> { return { ...DEFAULT_ROLE_MODELS }; }

/** Model for a role — managed mode is LOCKED to the cost-optimal defaults; BYOK honors user overrides. */
export function getRoleModel(role: ModelRole): string {
  if (_tokenMode === 'managed') return DEFAULT_ROLE_MODELS[role];
  return _roleOverrides[role] ?? DEFAULT_ROLE_MODELS[role];
}
export function getRoleModels(): Record<ModelRole, string> {
  return { capture: getRoleModel('capture'), insight: getRoleModel('insight'), assistant: getRoleModel('assistant') };
}
export function setRoleModelMem(role: ModelRole, modelId: string): void { _roleOverrides[role] = modelId; }
export function setTokenModeMem(mode: TokenMode): void { _tokenMode = mode; }

/** Routes a task to its role's model. */
export function modelForTask(task: AiTask, _fallback: string = DEFAULT_MODEL): string {
  return getRoleModel(TASK_ROLE[task]);
}

/** Hydrate role overrides + token mode from settings (call alongside loadPreferredModel at startup
 *  AND in the headless background task). */
export async function loadRoleModels(db: import('expo-sqlite').SQLiteDatabase): Promise<void> {
  try {
    const { getSetting } = await import('../db/settings');
    const mode = (await getSetting(db, TOKEN_MODE_SETTING))?.trim();
    if (mode === 'managed' || mode === 'byok') _tokenMode = mode;
    const roles: ModelRole[] = ['capture', 'insight', 'assistant'];
    for (const role of roles) {
      const v = (await getSetting(db, ROLE_MODEL_SETTING[role]))?.trim();
      if (v) _roleOverrides[role] = v;
    }
  } catch { /* keep cost-optimal defaults */ }
}

/** Persist + apply a BYOK role-model change immediately. */
export async function persistRoleModel(
  db: import('expo-sqlite').SQLiteDatabase, role: ModelRole, modelId: string,
): Promise<void> {
  setRoleModelMem(role, modelId);
  try {
    const { setSetting } = await import('../db/settings');
    await setSetting(db, ROLE_MODEL_SETTING[role], modelId);
  } catch { /* in-memory still applies for this session */ }
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
