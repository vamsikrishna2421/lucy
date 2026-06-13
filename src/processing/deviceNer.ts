/**
 * On-device Named-Entity Recognition for the Privacy Shield.
 *
 * Uses the local LLM (Phi-4 via executorch) to find person names the deterministic
 * detector (contacts + gazetteer + cues) would miss — list-free, fully on-device.
 *
 * Best-effort and SAFE: it never triggers a model download and never throws. If the
 * on-device model isn't prepared/ready, it returns [] and the shield falls back to the
 * deterministic detector. The names it returns are passed to shieldText() as extra
 * "contacts" so they get tokenized before any remote call.
 */
import { promptDevice, getDeviceModelState } from '../ai/device';
import { getDatabase } from '../db';
import { getSetting } from '../db/settings';

/** Settings key for the opt-in "use on-device AI to detect & protect sensitive info" toggle. */
export const SHIELD_LLM_SETTING = 'shield_use_local_llm';

/** Whether the user has opted into LLM-based name detection for the shield. */
export async function isLocalShieldNerEnabled(): Promise<boolean> {
  try {
    const db = await getDatabase();
    return (await getSetting(db, SHIELD_LLM_SETTING)) === 'true';
  } catch {
    return false;
  }
}

const NER_PROMPT =
  'You extract people\'s names from text. List EVERY person name that appears (first names, full names, nicknames). ' +
  'Do NOT include places, companies, products, brands, days, or the assistant name "LUCY". ' +
  'Return ONLY a compact JSON array of the exact name strings as they appear in the text — nothing else. ' +
  'Example: ["Jan Pyda","Sam"]. If there are no people, return [].\n\nText:\n';

/** Returns person names detected by the on-device LLM, or [] if unavailable. Never throws. */
export async function detectNamesOnDevice(text: string): Promise<string[]> {
  if (!text || !text.trim()) return [];
  // Only use the LLM if a local model is prepared (never block on a download) AND the
  // user has opted in via Settings. The cheap sync status check is first so the common
  // "off" case returns instantly with no DB read.
  if (getDeviceModelState().status !== 'ready') return [];
  if (!(await isLocalShieldNerEnabled())) return [];
  try {
    const raw = await promptDevice(`${NER_PROMPT}${text.slice(0, 4000)}\n/no_think`);
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start === -1 || end === -1) return [];
    const parsed: unknown = JSON.parse(raw.slice(start, end + 1));
    if (!Array.isArray(parsed)) return [];
    const names = parsed
      .filter((x): x is string => typeof x === 'string')
      .map((s) => s.trim())
      .filter((s) => s.length >= 2 && s.length <= 60 && /[A-Za-z]/.test(s));
    return [...new Set(names)].slice(0, 50);
  } catch {
    return [];
  }
}
