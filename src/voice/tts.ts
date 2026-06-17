/**
 * Text-to-speech — a thin, guarded wrapper over expo-speech so LUCY can speak replies aloud in the
 * conversation loop. Lazily required and fully guarded: if the native module is missing (e.g. a build
 * without it, or a node/test context) every call degrades to a no-op that still resolves, so callers
 * can always `await speak()` and continue.
 */
type SpeechModule = typeof import('expo-speech');
let mod: SpeechModule | null = null;
let loaded = false;

let selectedVoiceId: string | null = null;
let prefsLoaded = false;

async function speech(): Promise<SpeechModule | null> {
  if (loaded) return mod;
  loaded = true;
  try { mod = await import('expo-speech'); } catch { mod = null; }
  return mod;
}

/** Load the persisted voice preference into the module cache. No-op on failure. */
export async function loadVoicePrefs(): Promise<void> {
  try {
    const { getDatabase } = await import('../db');
    const { getSetting } = await import('../db/settings');
    const db = await getDatabase();
    selectedVoiceId = (await getSetting(db, 'tts_voice_id')) || null;
    prefsLoaded = true;
  } catch { /* no-op: keep defaults */ }
}

/** Persist and cache the chosen voice. Pass null to fall back to the system default. */
export async function setVoice(voiceId: string | null): Promise<void> {
  selectedVoiceId = voiceId;
  prefsLoaded = true;
  try {
    const { getDatabase } = await import('../db');
    const { setSetting } = await import('../db/settings');
    const db = await getDatabase();
    await setSetting(db, 'tts_voice_id', voiceId ?? '');
  } catch { /* no-op */ }
}

export function getSelectedVoiceId(): string | null {
  return selectedVoiceId;
}

export interface TtsVoice { identifier: string; name: string; language: string; quality?: string }

// Only these voices sound natural enough for Lucy; the rest are filtered out of the picker.
// Matched against the start of the voice name (covers "Samantha", "Karen (Enhanced)", etc.).
const ALLOWED_VOICE_PREFIXES = ['samantha', 'karen'];

/** List the curated good English voices available on this device, premium/enhanced first. */
export async function listVoices(): Promise<TtsVoice[]> {
  const S = await speech();
  if (!S) return [];
  try {
    const raw = await S.getAvailableVoicesAsync();
    const english: TtsVoice[] = (raw ?? [])
      .map((v) => ({ identifier: v.identifier, name: v.name, language: v.language, quality: v.quality as string | undefined }))
      .filter((v) => v.language.toLowerCase().startsWith('en'));
    const allowed = english.filter((v) =>
      ALLOWED_VOICE_PREFIXES.some((p) => v.name.trim().toLowerCase().startsWith(p)),
    );
    // Fall back to the full English list if this device has none of the curated voices,
    // so the picker is never empty (System default always remains available too).
    const voices = allowed.length > 0 ? allowed : english;
    const rank = (q?: string): number => {
      const s = (q ?? '').toLowerCase();
      if (s.includes('enhanced') || s.includes('premium')) return 0;
      return 1;
    };
    voices.sort((a, b) => rank(a.quality) - rank(b.quality) || a.name.localeCompare(b.name));
    return voices;
  } catch { return []; }
}

/** Speak text aloud. Resolves when speech finishes (or immediately if TTS is unavailable). */
export async function speak(
  text: string,
  opts?: { onStart?: () => void; rate?: number; pitch?: number; language?: string },
): Promise<void> {
  const S = await speech();
  const clean = (text || '').trim();
  if (!S || !clean) return;
  if (!prefsLoaded) await loadVoicePrefs();
  return new Promise<void>((resolve) => {
    let settled = false;
    const done = (): void => { if (!settled) { settled = true; resolve(); } };
    try {
      S.stop(); // never overlap with a previous utterance
      opts?.onStart?.();
      S.speak(clean, {
        rate: opts?.rate ?? 1.0,
        pitch: opts?.pitch ?? 1.0,
        language: opts?.language,
        voice: selectedVoiceId ?? undefined,
        onDone: done,
        onStopped: done,
        onError: done,
      });
    } catch { done(); }
  });
}

export async function stopSpeaking(): Promise<void> {
  const S = await speech();
  try { S?.stop(); } catch { /* ignore */ }
}

export async function isSpeaking(): Promise<boolean> {
  const S = await speech();
  try { return (await S?.isSpeakingAsync()) ?? false; } catch { return false; }
}
