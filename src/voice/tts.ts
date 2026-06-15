/**
 * Text-to-speech — a thin, guarded wrapper over expo-speech so LUCY can speak replies aloud in the
 * conversation loop. Lazily required and fully guarded: if the native module is missing (e.g. a build
 * without it, or a node/test context) every call degrades to a no-op that still resolves, so callers
 * can always `await speak()` and continue.
 */
type SpeechModule = typeof import('expo-speech');
let mod: SpeechModule | null = null;
let loaded = false;

async function speech(): Promise<SpeechModule | null> {
  if (loaded) return mod;
  loaded = true;
  try { mod = await import('expo-speech'); } catch { mod = null; }
  return mod;
}

/** Speak text aloud. Resolves when speech finishes (or immediately if TTS is unavailable). */
export async function speak(
  text: string,
  opts?: { onStart?: () => void; rate?: number; pitch?: number; language?: string },
): Promise<void> {
  const S = await speech();
  const clean = (text || '').trim();
  if (!S || !clean) return;
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
