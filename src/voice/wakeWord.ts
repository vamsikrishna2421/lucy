/**
 * Foreground "Hey Lucy" wake word — while the app is open AND the user has enabled it (Settings),
 * LUCY listens continuously on-device for "hey lucy" and, on hearing it, hands off to the conversation
 * loop (or runs the trailing command directly). It's the LOW-PRIORITY owner of the single recognizer:
 * it never grabs the mic from Listen mode or an active conversation — it watches the mic coordinator
 * and pauses while the mic is busy, resuming when it's free.
 *
 * iOS can't run a true system-wide always-on custom wake word (only Siri gets that), so this is
 * scoped to the foreground. Off by default; continuous recognition has a battery cost — surfaced in
 * Settings.
 */
import {
  ExpoSpeechRecognitionModule,
  type ExpoSpeechRecognitionErrorEvent,
  type ExpoSpeechRecognitionResultEvent,
} from 'expo-speech-recognition';
import { isMicBusy, onMicBusyChange } from '../audio/micCoordinator';

// "hey lucy" + common mishearings; also "hi/ok lucy". Captures any trailing command in the same breath.
const WAKE_RE = /\b(?:hey|hi|ok|okay|hey there)\s*,?\s*(?:lucy|lucie|loocy|loosey|lucid|lucky)\b[\s,.!?-]*(.*)/i;

class WakeWordListener {
  private enabled = false;
  private running = false;     // recognizer currently active
  private locale = 'en-US';
  private onWake: ((trailing: string | null) => void) | null = null;
  private subs: Array<{ remove(): void }> = [];
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubMic: (() => void) | null = null;
  private cooldownUntil = 0;   // ignore detections briefly after firing (debounce)

  get isEnabled(): boolean { return this.enabled; }

  /** Turn the wake word on. `onWake` fires with any words spoken after "hey lucy" (or null). */
  async enable(onWake: (trailing: string | null) => void): Promise<boolean> {
    this.onWake = onWake;
    if (this.enabled) return true;
    try {
      const perm = await ExpoSpeechRecognitionModule.requestMicrophonePermissionsAsync();
      // Match conversation.ts gate — don't require supportsOnDeviceRecognition() because that API
      // can return false even on devices where requiresOnDeviceRecognition:true works fine.
      if (!perm.granted || !ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
        return false;
      }
    } catch { return false; }
    try {
      const { getDatabase } = await import('../db');
      const { getUserProfile, getOnDeviceSpeechLocale } = await import('../db/userProfile');
      this.locale = getOnDeviceSpeechLocale(await getUserProfile(await getDatabase()));
    } catch { /* default */ }
    try {
      const supported = await ExpoSpeechRecognitionModule.getSupportedLocales({});
      const installed = (supported?.installedLocales ?? []) as string[];
      // Fall back to en-US when the profile locale isn't installed, OR when the
      // list is empty (device didn't enumerate — safer to use the universal default).
      if (!installed.includes(this.locale)) {
        console.warn(`[WakeWord] Locale ${this.locale} not in installedLocales; falling back to en-US`);
        this.locale = 'en-US';
      }
    } catch { /* not critical */ }

    this.enabled = true;
    // Pause while another owner (Listen / conversation) uses the mic; resume when free.
    this.unsubMic = onMicBusyChange((busy) => {
      if (!this.enabled) return;
      if (busy) this.pauseRecognition();
      else this.scheduleStart(400);
    });
    if (!isMicBusy()) this.scheduleStart(200);
    return true;
  }

  disable(): void {
    this.enabled = false;
    this.onWake = null;
    if (this.unsubMic) { this.unsubMic(); this.unsubMic = null; }
    this.pauseRecognition();
  }

  private scheduleStart(delay: number): void {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => this.startRecognition(), delay);
  }

  private startRecognition(): void {
    if (!this.enabled || this.running || isMicBusy()) return;
    this.configureListeners();
    try {
      ExpoSpeechRecognitionModule.start({
        lang: this.locale,
        interimResults: true,    // detect the wake word fast, mid-utterance
        continuous: true,
        requiresOnDeviceRecognition: true,
        addsPunctuation: false,
        iosCategory: { category: 'playAndRecord', categoryOptions: ['defaultToSpeaker', 'allowBluetooth'], mode: 'measurement' },
      });
      this.running = true;
    } catch { this.running = false; this.scheduleStart(1500); }
  }

  private pauseRecognition(): void {
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null; }
    this.clearListeners();
    try { ExpoSpeechRecognitionModule.abort(); } catch { /* ignore */ }
    this.running = false;
  }

  private configureListeners(): void {
    this.clearListeners();
    this.subs = [
      ExpoSpeechRecognitionModule.addListener('result', (e: ExpoSpeechRecognitionResultEvent) => {
        const text = e.results[0]?.transcript ?? '';
        if (!text) return;
        const m = WAKE_RE.exec(text);
        if (!m) return;
        if (Date.now() < this.cooldownUntil) return;
        this.cooldownUntil = Date.now() + 4000;
        const trailing = (m[1] || '').trim();
        this.fire(trailing || null);
      }),
      ExpoSpeechRecognitionModule.addListener('error', (e: ExpoSpeechRecognitionErrorEvent) => {
        if (!this.enabled || e.error === 'aborted') return;
        // no-speech / transient: just restart after a beat.
        this.running = false;
        this.scheduleStart(1200);
      }),
      ExpoSpeechRecognitionModule.addListener('end', () => {
        this.running = false;
        if (this.enabled && !isMicBusy()) this.scheduleStart(300);
      }),
    ];
  }
  private clearListeners(): void { for (const s of this.subs) s.remove(); this.subs = []; }

  private fire(trailing: string | null): void {
    // Stop our recognizer so the conversation loop can take the mic cleanly.
    this.pauseRecognition();
    void (async () => {
      try { const H = await import('expo-haptics'); await H.notificationAsync(H.NotificationFeedbackType.Success); } catch { /* ignore */ }
    })();
    try { this.onWake?.(trailing); } catch { /* non-critical */ }
    // If nothing took the mic (e.g. handler chose not to), resume after the cooldown.
    setTimeout(() => { if (this.enabled && !isMicBusy()) this.scheduleStart(200); }, 4200);
  }
}

export const wakeWord = new WakeWordListener();
