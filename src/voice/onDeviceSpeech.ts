// Shared on-device speech provisioning — keeps voice PRIVATE-first without dead-ending.
//
// LUCY prefers fully on-device transcription (no audio is ever sent to an LLM backend — Whisper was
// removed). But Android phones don't always have the on-device speech model for the user's locale
// downloaded yet, and forcing `requiresOnDeviceRecognition:true` in that state makes start() fail
// immediately with ERROR_CLIENT — a scary dead-end (see "No Scary States"). The Capture mic and the
// Hey-Lucy conversation both used to force it; the wake word deliberately doesn't.
//
// This helper unifies the decision:
//   • report whether the locale's on-device model is already installed, and
//   • best-effort trigger its download on Android so the device self-heals to fully-private next time.
// Callers pass the result to `requiresOnDeviceRecognition`: on-device when ready, otherwise let the
// OS recognizer handle it so the feature still works (same pragmatic stance as the wake word).
import { Platform } from 'react-native';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';

const baseLang = (locale: string): string => locale.split('-')[0]?.toLowerCase() ?? locale.toLowerCase();

/** True if an on-device model for `locale` (or its base language, e.g. en-GB → en) is installed. */
export async function isOnDeviceLocaleInstalled(locale: string): Promise<boolean> {
  try {
    const res = await ExpoSpeechRecognitionModule.getSupportedLocales({});
    const installed = (res?.installedLocales ?? []) as string[];
    if (installed.includes(locale)) return true;
    const base = baseLang(locale);
    return installed.some((l) => baseLang(l) === base);
  } catch {
    return false;
  }
}

/** Best-effort: ask Android to download the offline model for `locale`. No-op elsewhere / on error. */
export async function triggerOnDeviceModelDownload(locale: string): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await ExpoSpeechRecognitionModule.androidTriggerOfflineModelDownload({ locale });
  } catch {
    /* user can still dictate via the OS recognizer; the model may download later */
  }
}

/**
 * Decide how to transcribe `locale`, privacy-first.
 * Returns `{ onDevice }` — true when an on-device model is ready now. When it isn't, this kicks off
 * the model download (Android) so the device upgrades itself to fully-private on a later attempt.
 */
export async function resolveSpeechMode(locale: string): Promise<{ onDevice: boolean }> {
  // iOS: trust the OS. supportsOnDeviceRecognition() reflects whether Apple's on-device dictation is
  // ready — this is the proven behavior on the shipped iOS app, so don't change it. Apple manages its
  // own model downloads; there's no app-triggered download to do.
  if (Platform.OS === 'ios') {
    try { return { onDevice: ExpoSpeechRecognitionModule.supportsOnDeviceRecognition() }; }
    catch { return { onDevice: false }; }
  }
  // Android: check the installed offline models; if this locale's model isn't present, kick off its
  // download so the device self-heals to fully-private, and use the OS recognizer in the meantime.
  const onDevice = await isOnDeviceLocaleInstalled(locale);
  if (!onDevice) void triggerOnDeviceModelDownload(locale);
  return { onDevice };
}
