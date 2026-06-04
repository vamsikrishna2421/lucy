import { RecordingPresets, setAudioModeAsync, requestRecordingPermissionsAsync } from 'expo-audio';
import { Platform } from 'react-native';

// AudioRecorder is NOT exported from expo-audio's public API.
// useAudioRecorder() internally uses AudioModule.AudioRecorder (the native module).
// We access it the same way to instantiate recorders outside React context.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AudioModule = (require('expo-audio/build/AudioModule') as { default: { AudioRecorder: new (opts: unknown) => RecorderInstance } }).default;

// Flatten the nested platform preset to the format the native constructor expects.
// This mirrors createRecordingOptions() from expo-audio/build/utils/options.
function flattenPreset(preset: typeof RecordingPresets.HIGH_QUALITY): Record<string, unknown> {
  const base = { extension: preset.extension, sampleRate: preset.sampleRate, numberOfChannels: preset.numberOfChannels, bitRate: preset.bitRate, isMeteringEnabled: false };
  const platform = Platform.OS === 'ios' ? preset.ios : Platform.OS === 'android' ? preset.android : preset.web;
  return { ...base, ...(platform ?? {}) };
}
import { File as FSFile } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { config } from '../config';
import { enqueueTranscript } from '../processing/extract';
import { transcribeAudioFile } from './WhisperTranscriber';
import { getRemoteOpenAIKey } from '../ai/remoteAccess';

type RecorderInstance = { prepareToRecordAsync(): Promise<void>; record(): void; stop(): Promise<void>; uri: string | null; release?: () => void };

// Try on-device STT first (SFSpeechRecognizer via react-native-voice).
let Voice: VoiceModule | null = null;
try {
  Voice = (require('@react-native-voice/voice') as { default: VoiceModule }).default;
} catch { /* not available */ }

interface VoiceModule {
  onSpeechResults: ((e: { value?: string[] }) => void) | null;
  onSpeechEnd: ((e: unknown) => void) | null;
  onSpeechError: ((e: unknown) => void) | null;
  start(locale: string): Promise<void>;
  stop(): Promise<void>;
  destroy(): Promise<void>;
}

export type ListeningStatus = 'off' | 'starting' | 'listening' | 'stopping';

export interface PassiveListenerState {
  status: ListeningStatus;
  wordsHeard: number;
  sessionStartedAt: number | null;
  /** Seconds elapsed in the CURRENT batch (resets on every rotation). */
  recordingSeconds: number;
  /** Seconds until the current batch is sent for transcription. */
  secondsUntilNextBatch: number;
  /** Whether this session uses on-device STT or batch+Whisper */
  mode: 'stt' | 'batch' | 'none';
  /** True when API key is missing and word count will never update */
  noApiKey: boolean;
  /** True when microphone permission was denied */
  noMicAccess: boolean;
}

class PassiveListenerManager {
  /** Batch duration in seconds — shorter = more responsive, more Whisper calls. */
  private static readonly BATCH_SECONDS = 30; // was 10 min; 30s = <45s end-to-end

  private state: PassiveListenerState = {
    status: 'off', wordsHeard: 0, sessionStartedAt: null,
    recordingSeconds: 0, secondsUntilNextBatch: PassiveListenerManager.BATCH_SECONDS,
    mode: 'none', noApiKey: false, noMicAccess: false,
  };
  private batchStartedAt = 0;
  private stateListeners: Array<(s: PassiveListenerState) => void> = [];
  private recorder: RecorderInstance | null = null;
  private batchTimer: ReturnType<typeof setInterval> | null = null;
  private secondTimer: ReturnType<typeof setInterval> | null = null;
  private active = false;
  private meetingMode = false;
  private languageHint: string | null = null; // ISO-639-1 code for primary language
  private voiceBuffer: string[] = [];
  private voiceRestartTimer: ReturnType<typeof setTimeout> | null = null;
  private transcriptAccumulator: string[] = [];
  // UUID generated at session start, set on every enqueued batch so all clips
  // from one session can be grouped together in the Brain → Listen tab.
  private sessionId: string | null = null;

  subscribe(fn: (s: PassiveListenerState) => void): () => void {
    this.stateListeners.push(fn);
    fn({ ...this.state });
    return () => { this.stateListeners = this.stateListeners.filter((l) => l !== fn); };
  }

  getState(): PassiveListenerState { return { ...this.state }; }
  get isAvailable(): boolean { return true; }
  get usesOnDeviceSTT(): boolean { return Voice !== null; }

  /** Returns full accumulated transcript for the current/last session (for Meeting Mode) */
  getAccumulatedTranscript(): string {
    return this.transcriptAccumulator.join(' ').trim();
  }

  /** Clears the transcript accumulator — call after consuming it */
  clearTranscript(): void {
    this.transcriptAccumulator = [];
  }

  private emit(): void { for (const fn of this.stateListeners) fn({ ...this.state }); }
  private patch(patch: Partial<PassiveListenerState>): void { this.state = { ...this.state, ...patch }; this.emit(); }

  async start(options?: { meetingMode?: boolean }): Promise<void> {
    if (this.state.status !== 'off') return;
    this.meetingMode = options?.meetingMode ?? false;
    this.patch({ status: 'starting', wordsHeard: 0, sessionStartedAt: Date.now(), recordingSeconds: 0 });
    this.transcriptAccumulator = [];
    this.sessionId = Crypto.randomUUID();
    this.active = true;
    // Request microphone permission explicitly — prepareToRecordAsync() throws silently if denied.
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        this.patch({ status: 'off', sessionStartedAt: null, noMicAccess: true });
        this.active = false;
        const { Alert } = await import('react-native');
        Alert.alert(
          'Microphone access needed',
          'LUCY needs microphone access to record in Listen mode. Go to Settings → Privacy & Security → Microphone → LUCY and enable it.',
          [{ text: 'OK' }],
        );
        return;
      }
    } catch { /* permission API not available — proceed and let prepareToRecordAsync handle it */ }
    this.patch({ noMicAccess: false });

    // allowsBackgroundRecording ensures recording continues when the app is minimised.
    try { await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, allowsBackgroundRecording: true }); } catch { /* non-fatal */ }

    // Consent signal when listening starts
    try {
      const Haptics = await import('expo-haptics');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch { /* haptics not supported on this device */ }

    // Load user preferences: language hint and transcription engine preference
    let preferDeviceSTT = false;
    let langCode: string | null = null;
    try {
      const { getDatabase } = await import('../db');
      const { getUserProfile, getWhisperLanguageHint } = await import('../db/userProfile');
      const db = await getDatabase();
      const profile = await getUserProfile(db);
      langCode = getWhisperLanguageHint(profile);
      this.languageHint = langCode;
      preferDeviceSTT = profile.transcriptionEngine === 'device';
      if (preferDeviceSTT && !Voice) {
        console.warn('[Listen] On-device STT preferred but @react-native-voice not installed; using Whisper');
      }
    } catch { /* non-critical */ }

    // Set language hint on Voice STT module if available
    // (react-native-voice uses the iOS locale code, e.g. 'te-IN' for Telugu)
    if (Voice && langCode) {
      const localeMap: Record<string, string> = { te: 'te-IN', hi: 'hi-IN', ta: 'ta-IN', kn: 'kn-IN', ml: 'ml-IN', mr: 'mr-IN', en: 'en-US' };
      (Voice as { locale?: string }).locale = localeMap[langCode] ?? `${langCode}-IN`;
    }

    // Use on-device STT if: user prefers it AND Voice module is available
    // Use Whisper if: user prefers cloud OR Voice unavailable
    const useVoice = Voice && (preferDeviceSTT || false);

    // Check if API key is present (batch mode needs it to count words)
    let noApiKey = false;
    if (!useVoice) {
      try {
        const key = await getRemoteOpenAIKey();
        noApiKey = !key;
      } catch { noApiKey = true; }
    }

    if (useVoice) {
      this.patch({ mode: 'stt', noApiKey: false });
      await this.startVoiceSTT();
      this.batchTimer = setInterval(() => void this.flushVoiceBuffer(), config.passiveListenBatchMinutes * 60 * 1000);
    } else {
      this.patch({ mode: 'batch', noApiKey });
      await this.startRecordingBatch();
      // 30-second batches → <45s end-to-end (Whisper ~3-8s + extraction ~2-4s).
      // Short batches mean more API calls but dramatically better responsiveness.
      // Stopping early still processes the partial batch immediately (see stop()).
      this.batchTimer = setInterval(() => void this.rotateBatch(), PassiveListenerManager.BATCH_SECONDS * 1000);
      // Tick every second: update elapsed time and countdown to next batch
      this.secondTimer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - this.batchStartedAt) / 1000);
        const remaining = Math.max(0, PassiveListenerManager.BATCH_SECONDS - elapsed);
        this.patch({ recordingSeconds: elapsed, secondsUntilNextBatch: remaining });
      }, 1000);
    }
    this.patch({ status: 'listening' });
  }

  private async startVoiceSTT(): Promise<void> {
    if (!Voice || !this.active) return;
    Voice.onSpeechResults = (e) => {
      const text = (e.value ?? []).join(' ').trim();
      if (text) { this.voiceBuffer.push(text); this.transcriptAccumulator.push(text); this.patch({ wordsHeard: this.state.wordsHeard + text.split(/\s+/).length }); }
    };
    Voice.onSpeechEnd = () => { if (this.active) this.voiceRestartTimer = setTimeout(() => void this.startVoiceSTT(), 300); };
    Voice.onSpeechError = () => { if (this.active) this.voiceRestartTimer = setTimeout(() => void this.startVoiceSTT(), 2000); };
    try {
      const localeMap: Record<string, string> = { te: 'te-IN', hi: 'hi-IN', ta: 'ta-IN', kn: 'kn-IN', ml: 'ml-IN', mr: 'mr-IN', en: 'en-US' };
      const locale = this.languageHint ? (localeMap[this.languageHint] ?? `${this.languageHint}-IN`) : 'en-US';
      await Voice.start(locale);
      this.voiceRestartTimer = setTimeout(() => { if (this.active && Voice) Voice.stop().catch(() => {}); }, 50_000);
    } catch { if (this.active) this.voiceRestartTimer = setTimeout(() => void this.startVoiceSTT(), 3000); }
  }

  private async flushVoiceBuffer(): Promise<void> {
    if (this.voiceBuffer.length === 0) return;
    const text = this.voiceBuffer.join(' ').trim();
    this.voiceBuffer = [];
    if (text.split(/\s+/).length >= 5) { try { await enqueueTranscript(text, 'passive', false, this.sessionId); } catch { /* non-critical */ } }
  }

  private async startRecordingBatch(): Promise<void> {
    this.batchStartedAt = Date.now();
    this.patch({ recordingSeconds: 0, secondsUntilNextBatch: PassiveListenerManager.BATCH_SECONDS });
    try {
      const opts = flattenPreset(RecordingPresets.HIGH_QUALITY);
      this.recorder = new AudioModule.AudioRecorder(opts);
      await this.recorder.prepareToRecordAsync();
      this.recorder.record();
      console.log('[Listen] Recording started, uri:', this.recorder.uri);
    } catch (e) {
      console.error('[Listen] startRecordingBatch failed:', e);
      this.recorder = null;
    }
  }

  private async stopRecorder(): Promise<string | null> {
    if (!this.recorder) return null;
    const rec = this.recorder;
    this.recorder = null; // clear early so concurrent calls don't double-stop
    try {
      await Promise.race([
        rec.stop(),
        new Promise<void>((_, rej) => setTimeout(() => rej(new Error('stop timeout')), 5000)),
      ]);
    } catch (e) {
      console.warn('[Listen] stopRecorder warning:', e);
    }
    // Read URI AFTER stop() — expo-audio sets uri when the file is finalized on disk
    const uri = rec.uri ?? null;
    console.log('[Listen] stopRecorder → uri:', uri, 'size will be checked next');
    try { rec.release?.(); } catch { /* ignore */ }
    return uri;
  }

  private async rotateBatch(): Promise<void> {
    if (!this.active) return;
    const uri = await this.stopRecorder();
    if (uri) void this.transcribeAndProcess(uri);
    if (this.active) {
      await new Promise<void>((res) => setTimeout(res, 300));
      await this.startRecordingBatch();
    }
  }

  private async transcribeAndProcess(uri: string): Promise<void> {
    const sessionId = this.sessionId; // capture before any await clears it
    console.log(`[Listen] transcribeAndProcess uri=${String(uri).slice(0, 80)}`);
    try {
      // SDK 56: use new File class instead of deprecated FileSystem.getInfoAsync
      const file = new FSFile(uri);
      const fileExists = file.exists;
      const fileSize = fileExists ? (file.size ?? 0) : 0;
      console.log(`[Listen] Clip: exists=${fileExists}, size=${fileSize}B`);

      if (!fileExists || fileSize < 1_000) {
        if (!this.meetingMode) {
          await enqueueTranscript('[Voice clip recorded — audio file was empty]', 'passive', false, sessionId);
        }
        try { file.delete(); } catch { /* ignore */ }
        return;
      }

      let text: string | null = null;
      let whisperError: string | null = null;
      try {
        text = await transcribeAudioFile(uri, this.languageHint);
      } catch (we) {
        whisperError = we instanceof Error ? we.message : String(we);
      }
      console.log(`[Listen] Whisper: ${text ? `${text.split(/\s+/).length}w` : `null (err: ${whisperError})`}`);

      const wordCount = text ? text.split(/\s+/).length : 0;
      if (text && wordCount >= 3) {
        this.transcriptAccumulator.push(text);
        this.patch({ wordsHeard: this.state.wordsHeard + wordCount });
        if (!this.meetingMode) {
          // Cost guard: clips < 8 words are saved but skip expensive LLM extraction.
          // Short clips (filler words, brief sounds) rarely contain actionable content.
          // Clips >= 8 words go through full extraction.
          await enqueueTranscript(text, 'passive', false, sessionId);
          if (wordCount >= 8) {
            void import('../processing/extract').then(({ processQueue }) =>
              processQueue(undefined, 1),
            ).catch(() => {});
          }
        }
      } else if (!this.meetingMode) {
        const note = text
          ? `[Voice clip — too short to save: "${text}"]`
          : whisperError
            ? `[Voice clip — Whisper error: ${whisperError.slice(0, 150)}]`
            : `[Voice clip — ${fileSize}B recorded, no OpenAI key found in Settings → Remote intelligence]`;
        await enqueueTranscript(note, 'passive', false, sessionId);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[Listen] transcribeAndProcess error:', msg);
      try { await enqueueTranscript(`[Voice clip — error: ${msg.slice(0, 120)}]`, 'passive', false, sessionId); } catch { /* ignore */ }
    }
    try { new FSFile(uri).delete(); } catch { /* ignore */ }
  }

  async stop(): Promise<void> {
    if (this.state.status === 'off') return;
    this.patch({ status: 'stopping' });
    this.active = false;
    clearInterval(this.batchTimer!);
    clearInterval(this.secondTimer!);
    clearTimeout(this.voiceRestartTimer!);
    this.batchTimer = null;
    this.secondTimer = null;
    this.voiceRestartTimer = null;
    if (Voice) { try { await Voice.destroy(); } catch { /* ignore */ } await this.flushVoiceBuffer(); }
    const uri = await this.stopRecorder();
    if (uri) {
      await this.transcribeAndProcess(uri);
    } else if (this.sessionId) {
      // Recorder never produced audio (permission denied or init error) — save marker
      try {
        await enqueueTranscript('[Listen session — no audio recorded. Check microphone permission in Settings → Privacy → Microphone.]', 'passive', false, this.sessionId);
      } catch { /* ignore */ }
    }
    try { await setAudioModeAsync({ allowsRecording: false }); } catch { /* non-fatal */ }
    this.sessionId = null;
    this.patch({ status: 'off', sessionStartedAt: null });
  }
}

export const passiveListener = new PassiveListenerManager();
