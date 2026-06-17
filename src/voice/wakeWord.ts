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

// Fuzzy / phonetic wake-word matching. Cloud speech recognizers garble "Lucy" into all sorts of
// near-pronunciations for accented speakers ("hey loosy", "a lucy", "lassi", "hey lucia", "lucky"…),
// so instead of a fixed alternatives list we map each spoken word to a rough phonetic key and accept
// anything that sounds close to "lucy" (phonetic key "lusi").

/**
 * Normalize a single word to a rough phonetic form so that accent variants / mishearings of the same
 * name collapse together. Intentionally simple — good enough to cluster "lucy"-likes near "lusi".
 */
function phoneticKey(word: string): string {
  let w = (word || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return '';
  // ph -> f
  w = w.replace(/ph/g, 'f');
  // trailing ie / ey / y -> i  (lucie, lucey, lucy -> luci-ish)
  w = w.replace(/(?:ie|ey|y)$/g, 'i');
  // c/k/q soft before e/i/y -> s, otherwise hard -> k
  let out = '';
  for (let i = 0; i < w.length; i++) {
    const ch = w[i];
    if (ch === 'c' || ch === 'k' || ch === 'q') {
      const next = w[i + 1];
      out += (next === 'e' || next === 'i' || next === 'y') ? 's' : 'k';
    } else if (ch === 'z') {
      out += 's';
    } else {
      out += ch;
    }
  }
  // collapse doubled letters -> single
  out = out.replace(/(.)\1+/g, '$1');
  return out;
}

/** Standard Levenshtein edit distance (small DP). */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    const cur = new Array(n + 1);
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

const LUCY_KEY = phoneticKey('lucy'); // "lusi"

/** True if a spoken word is a plausible "Lucy" — phonetically close, or an accent-y luc/loo/lus prefix. */
function isLucyToken(word: string): boolean {
  const raw = (word || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!raw) return false;
  if (levenshtein(phoneticKey(raw), LUCY_KEY) <= 1) return true;
  if (raw.length >= 3 && raw.length <= 6 &&
      (raw.startsWith('luc') || raw.startsWith('loo') || raw.startsWith('lus'))) return true;
  return false;
}

export type WakeWordStatus = 'disabled' | 'starting' | 'listening' | 'unavailable';

class WakeWordListener {
  private enabled = false;
  private running = false;     // recognizer currently active
  private locale = 'en-US';
  private onWake: ((trailing: string | null) => void) | null = null;
  private subs: Array<{ remove(): void }> = [];
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubMic: (() => void) | null = null;
  private cooldownUntil = 0;   // ignore detections briefly after firing (debounce)
  private statusListeners = new Set<(s: WakeWordStatus) => void>();
  private _status: WakeWordStatus = 'disabled';
  private lastEventAt = 0;     // last time the recognizer emitted any event (for the watchdog)
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;

  private setStatus(s: WakeWordStatus): void {
    if (this._status === s) return;
    this._status = s;
    for (const l of this.statusListeners) l(s);
  }

  get status(): WakeWordStatus { return this._status; }
  get isEnabled(): boolean { return this.enabled; }

  onStatusChange(fn: (s: WakeWordStatus) => void): () => void {
    this.statusListeners.add(fn);
    return () => { this.statusListeners.delete(fn); };
  }

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
      // Fall back to en-US when the profile locale isn't installed.
      // If the list is empty the device couldn't enumerate locales (not that nothing is installed),
      // so silently keep the current locale rather than warning or overriding unnecessarily.
      if (installed.length > 0 && !installed.includes(this.locale)) {
        console.warn(`[WakeWord] Locale ${this.locale} not in installedLocales; falling back to en-US`);
        this.locale = 'en-US';
      }
    } catch { /* not critical */ }

    this.enabled = true;
    this.setStatus('starting');
    // Pause while another owner (Listen / conversation) uses the mic; resume when free.
    this.unsubMic = onMicBusyChange((busy) => {
      if (!this.enabled) return;
      if (busy) this.pauseRecognition();
      else this.scheduleStart(400);
    });
    if (!isMicBusy()) this.scheduleStart(200);
    this.startWatchdog();
    return true;
  }

  disable(): void {
    this.enabled = false;
    this.onWake = null;
    if (this.unsubMic) { this.unsubMic(); this.unsubMic = null; }
    this.stopWatchdog();
    this.pauseRecognition();
    this.setStatus('disabled');
  }

  /**
   * iOS can silently tear down the recognizer (audio-session loss after backgrounding, another app
   * grabbing the mic, etc.) WITHOUT firing 'end' or 'error'. When that happens `running` stays true,
   * so startRecognition() keeps early-returning and the wake word is wedged — it looks "listening"
   * but hears nothing. This watchdog notices the silence and force-restarts a fresh recognizer.
   */
  private startWatchdog(): void {
    if (this.watchdogTimer) return;
    this.lastEventAt = Date.now();
    this.watchdogTimer = setInterval(() => {
      if (!this.enabled || isMicBusy()) return;
      const stale = Date.now() - this.lastEventAt > 20000;
      if (this.running && stale) {
        console.warn('[WakeWord] watchdog: recognizer wedged — forcing restart');
        this.pauseRecognition();
        this.scheduleStart(300);
      } else if (!this.running && !this.restartTimer) {
        // Missed a restart somehow — recover.
        this.scheduleStart(300);
      }
    }, 5000);
  }

  private stopWatchdog(): void {
    if (this.watchdogTimer) { clearInterval(this.watchdogTimer); this.watchdogTimer = null; }
  }

  private scheduleStart(delay: number): void {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => this.startRecognition(), delay);
  }

  private startRecognition(): void {
    if (!this.enabled || this.running || isMicBusy()) return;
    this.setStatus('starting');
    this.configureListeners();
    try {
      ExpoSpeechRecognitionModule.start({
        lang: this.locale,
        interimResults: true,    // detect the wake word fast, mid-utterance
        continuous: true,
        // requiresOnDeviceRecognition intentionally omitted: forcing on-device causes the recognizer
        // to fail on devices where the on-device speech model isn't downloaded (iOS Settings →
        // General → Keyboards → Dictation). Cloud speech is acceptable here — the wake word feature
        // must work reliably, and the app is already in the foreground when listening.
        addsPunctuation: false,
        // No iosCategory — let the system manage the audio session, same as the Capture voice button.
      });
      this.running = true;
      this.lastEventAt = Date.now();
    } catch (e) {
      console.warn('[WakeWord] start failed:', e);
      this.running = false;
      this.setStatus('unavailable');
      this.scheduleStart(3000);
    }
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
        this.lastEventAt = Date.now();
        // Check all hypotheses (results[0] is best; others are alternates)
        for (let i = 0; i < e.results.length; i++) {
          const text = e.results[i]?.transcript ?? '';
          if (!text) continue;
          if (i === 0) {
            // Log every non-empty transcript so DevLog can show what iOS heard
            console.log('[WakeWord] heard:', JSON.stringify(text));
            this.setStatus('listening');
          }
          const tokens = text.split(/[\s,.!?-]+/).filter(Boolean);
          if (!tokens.length) continue;
          // In `continuous` mode iOS ACCUMULATES the whole session transcript, so a just-spoken
          // "hey lucy" lands among the MOST RECENT words, not the first ones. Scan the tail
          // (last 6 tokens) from the end and take the latest Lucy-like token.
          const start = Math.max(0, tokens.length - 6);
          let matchIdx = -1;
          for (let t = tokens.length - 1; t >= start; t--) {
            if (isLucyToken(tokens[t])) { matchIdx = t; break; }
          }
          if (matchIdx === -1) continue;
          if (Date.now() < this.cooldownUntil) return;
          this.cooldownUntil = Date.now() + 4000;
          const trailing = tokens.slice(matchIdx + 1).join(' ').trim();
          console.log('[WakeWord] MATCHED text:', JSON.stringify(text), 'token:', JSON.stringify(tokens[matchIdx]), 'trailing:', trailing);
          this.fire(trailing || null);
          return;
        }
      }),
      ExpoSpeechRecognitionModule.addListener('error', (e: ExpoSpeechRecognitionErrorEvent) => {
        if (!this.enabled || e.error === 'aborted') return;
        this.lastEventAt = Date.now();
        console.warn('[WakeWord] error:', e.error, e.message);
        this.running = false;
        // Fatal errors — retrying won't help; mark unavailable and stop.
        if (e.error === 'language-not-supported' || e.error === 'not-allowed') {
          this.setStatus('unavailable');
          return;
        }
        // Transient errors (no-speech, network, audio-hardware, etc.): restart after a beat.
        this.setStatus('starting');
        this.scheduleStart(1200);
      }),
      ExpoSpeechRecognitionModule.addListener('end', () => {
        this.lastEventAt = Date.now();
        this.running = false;
        if (this.enabled && !isMicBusy()) {
          this.setStatus('starting');
          this.scheduleStart(300);
        }
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
    console.log('[WakeWord] firing onWake, hasCallback:', !!this.onWake, 'trailing:', trailing);
    try { this.onWake?.(trailing); } catch (e) { console.warn('[WakeWord] onWake threw:', e); }
    // If nothing took the mic (e.g. handler chose not to), resume after the cooldown.
    setTimeout(() => { if (this.enabled && !isMicBusy()) this.scheduleStart(200); }, 4200);
  }
}

export const wakeWord = new WakeWordListener();
