/**
 * Conversation engine — a hands-free, multi-turn spoken loop with LUCY (ChatGPT-voice style):
 *
 *   listen (on-device STT) → think (command brain) → speak reply (TTS) → listen again …
 *
 * Each finished utterance runs through runVoiceCommand, so the user can both ASK questions and TAKE
 * actions ("schedule a walk at 6", "remember that…") entirely by voice. Recognition is paused while
 * LUCY speaks so she never transcribes her own voice. Uses the shared mic coordinator so Listen mode
 * and the wake word yield while a conversation is active.
 */
import {
  ExpoSpeechRecognitionModule,
  type ExpoSpeechRecognitionErrorEvent,
  type ExpoSpeechRecognitionResultEvent,
} from 'expo-speech-recognition';
import { acquireMic, releaseMic } from '../audio/micCoordinator';
import { speak, stopSpeaking } from './tts';

export type ConvoState = 'off' | 'listening' | 'thinking' | 'speaking';
export interface ConvoTurn { role: 'user' | 'lucy'; text: string }
export interface ConvoSnapshot { state: ConvoState; turns: ConvoTurn[]; partial: string; error: string | null }

// Spoken phrases that end the conversation. Kept conservative so normal mid-chat words don't end it.
const END_RE = /\b(stop listening|stop conversation|end conversation|never mind|that'?s all|that is all|good ?bye|^bye$|we'?re done|i'?m done|that'?ll be all)\b/i;

class ConversationManager {
  private state: ConvoState = 'off';
  private turns: ConvoTurn[] = [];
  private partial = '';
  private error: string | null = null;
  private active = false;
  private locale = 'en-US';
  private context: string | undefined;
  private getContext: (() => string) | null = null;
  private onNavigate: ((section: string) => void) | null = null;
  private subs: Array<{ remove(): void }> = [];
  private listeners = new Set<(s: ConvoSnapshot) => void>();
  private endTimer: ReturnType<typeof setTimeout> | null = null;

  subscribe(fn: (s: ConvoSnapshot) => void): () => void {
    this.listeners.add(fn);
    fn(this.snapshot());
    return () => { this.listeners.delete(fn); };
  }
  private snapshot(): ConvoSnapshot { return { state: this.state, turns: [...this.turns], partial: this.partial, error: this.error }; }
  private emit(): void { const s = this.snapshot(); for (const l of this.listeners) l(s); }
  private set(state: ConvoState): void { this.state = state; this.emit(); }
  getState(): ConvoState { return this.state; }

  async start(opts?: { context?: string; getContext?: () => string; onNavigate?: (section: string) => void; initialText?: string }): Promise<void> {
    if (this.state !== 'off') return;
    this.context = opts?.context;
    this.getContext = opts?.getContext ?? null;
    this.onNavigate = opts?.onNavigate ?? null;
    this.turns = []; this.partial = ''; this.error = null;
    this.active = true;
    acquireMic('conversation');
    this.set('thinking'); // brief "warming up" before the first listen

    // Permission + on-device availability (same gates as Listen mode).
    try {
      const perm = await ExpoSpeechRecognitionModule.requestMicrophonePermissionsAsync();
      if (!perm.granted || !ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
        return this.fail('Microphone or speech recognition is unavailable. Enable it in Settings.');
      }
    } catch (e) {
      return this.fail(`Could not start voice: ${e instanceof Error ? e.message : String(e)}`);
    }
    try {
      const { getDatabase } = await import('../db');
      const { getUserProfile, getOnDeviceSpeechLocale } = await import('../db/userProfile');
      this.locale = getOnDeviceSpeechLocale(await getUserProfile(await getDatabase()));
    } catch { /* default en-US */ }
    try {
      const supported = await ExpoSpeechRecognitionModule.getSupportedLocales({});
      const installed = (supported?.installedLocales ?? []) as string[];
      if (installed.length > 0 && !installed.includes(this.locale)) {
        console.warn(`[Convo] Locale ${this.locale} not installed on-device; falling back to en-US`);
        this.locale = 'en-US';
      }
    } catch { /* not critical */ }

    this.configureListeners();
    if (opts?.initialText) {
      await this.handleUtterance(opts.initialText);
    } else {
      await speak("I'm listening — what's up?");
      if (!this.active) return;
      this.beginListening();
    }
  }

  private configureListeners(): void {
    this.clearListeners();
    this.subs = [
      ExpoSpeechRecognitionModule.addListener('result', (e: ExpoSpeechRecognitionResultEvent) => {
        if (this.state !== 'listening') return;
        const text = e.results[0]?.transcript?.trim() ?? '';
        if (!text) return;
        if (!e.isFinal) { this.partial = text; this.emit(); return; }
        this.partial = '';
        void this.handleUtterance(text);
      }),
      ExpoSpeechRecognitionModule.addListener('error', (e: ExpoSpeechRecognitionErrorEvent) => {
        if (!this.active || e.error === 'aborted' || e.error === 'no-speech') return;
        this.fail(`Voice error (${e.error}). ${e.message || ''}`.trim());
      }),
      ExpoSpeechRecognitionModule.addListener('end', () => {
        // The recognizer stops itself after each utterance; keep it alive while we're listening.
        if (this.active && this.state === 'listening') {
          this.endTimer = setTimeout(() => this.startRecognition(), 250);
        }
      }),
    ];
  }
  private clearListeners(): void { for (const s of this.subs) s.remove(); this.subs = []; }

  private beginListening(): void {
    if (!this.active) return;
    this.set('listening');
    this.startRecognition();
  }

  private startRecognition(): void {
    if (!this.active || this.state !== 'listening') return;
    try {
      ExpoSpeechRecognitionModule.start({
        lang: this.locale,
        interimResults: true,
        continuous: true,
        requiresOnDeviceRecognition: true,
        addsPunctuation: true,
        iosCategory: { category: 'playAndRecord', categoryOptions: ['defaultToSpeaker', 'allowBluetooth'], mode: 'measurement' },
      });
    } catch (e) {
      this.fail(`Could not start listening. ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private async handleUtterance(text: string): Promise<void> {
    if (!this.active) return;
    if (END_RE.test(text)) { this.turns.push({ role: 'user', text }); this.emit(); await this.speakAndEnd('Okay — talk soon.'); return; }
    // Pause recognition while thinking + speaking so LUCY doesn't hear herself.
    try { ExpoSpeechRecognitionModule.stop(); } catch { /* ignore */ }
    // Capture prior turns as history (before pushing this utterance) so LUCY remembers a
    // multi-step flow like a live demo walkthrough.
    const history = this.turns.map((t) => ({ role: t.role, content: t.text }));
    this.turns.push({ role: 'user', text });
    this.set('thinking');
    let reply = '';
    let navigate: string | null = null;
    try {
      const { runVoiceCommand } = await import('./commandRouter');
      // Read the CURRENT screen each turn (live) so LUCY is aware of where the user navigated.
      const liveContext = this.getContext ? this.getContext() : this.context;
      const r = await runVoiceCommand(text, undefined, liveContext, history);
      reply = (r.speak || '').trim() || "I'm not sure about that one.";
      navigate = r.navigate ?? null;
    } catch {
      reply = 'Sorry — something went wrong with that. Try again?';
    }
    if (!this.active) return;
    this.turns.push({ role: 'lucy', text: reply });
    if (navigate && this.onNavigate) { try { this.onNavigate(navigate); } catch { /* non-critical */ } }
    this.set('speaking');
    await speak(reply);
    if (!this.active) return;
    this.beginListening(); // back to the user
  }

  private async speakAndEnd(text: string): Promise<void> {
    this.turns.push({ role: 'lucy', text });
    this.set('speaking');
    try { ExpoSpeechRecognitionModule.stop(); } catch { /* ignore */ }
    await speak(text);
    await this.end();
  }

  private fail(message: string): void {
    this.error = message;
    void this.end();
  }

  async end(): Promise<void> {
    if (this.endTimer) { clearTimeout(this.endTimer); this.endTimer = null; }
    this.active = false;
    try { ExpoSpeechRecognitionModule.abort(); } catch { /* ignore */ }
    this.clearListeners();
    try {
      await stopSpeaking();
      this.partial = '';
      this.set('off');
    } finally {
      releaseMic('conversation');
    }
  }
}

export const conversation = new ConversationManager();
