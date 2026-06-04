import { RecordingPresets, setAudioModeAsync, requestRecordingPermissionsAsync } from 'expo-audio';
import { Platform } from 'react-native';

// expo-audio's AudioRecorder constructor expects platform-flattened options,
// not the nested {ios:{...}, android:{...}} structure of RecordingPresets.
// This mirrors what useAudioRecorder() does internally via createRecordingOptions().
function flattenPreset(preset: typeof RecordingPresets.HIGH_QUALITY): Record<string, unknown> {
  const base = { extension: preset.extension, sampleRate: preset.sampleRate, numberOfChannels: preset.numberOfChannels, bitRate: preset.bitRate, isMeteringEnabled: false };
  const platform = Platform.OS === 'ios' ? preset.ios : Platform.OS === 'android' ? preset.android : preset.web;
  return { ...base, ...(platform ?? {}) };
}
import * as FileSystem from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { config } from '../config';
import { enqueueTranscript } from '../processing/extract';
import { transcribeAudioFile } from './WhisperTranscriber';
import { getRemoteOpenAIKey } from '../ai/remoteAccess';

// AudioRecorder is type-only in expo-audio — use require() to get the runtime class.
type RecorderInstance = { prepareToRecordAsync(): Promise<void>; record(): void; stop(): Promise<void>; uri: string | null; release?: () => void };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AudioRecorderClass = (require('expo-audio') as { AudioRecorder: new (opts: unknown) => RecorderInstance }).AudioRecorder;

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

  async start(): Promise<void> {
    if (this.state.status !== 'off') return;
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

    // Check if API key is present (batch mode needs it to count words)
    let noApiKey = false;
    if (!Voice) {
      try {
        const key = await getRemoteOpenAIKey();
        noApiKey = !key;
      } catch { noApiKey = true; }
    }

    if (Voice) {
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
      await Voice.start('en-US');
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
      this.recorder = new AudioRecorderClass(opts);
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
    // Read URI BEFORE stop — it's set when recording starts; stop() may clear it on error.
    const uri = this.recorder.uri ?? null;
    try {
      await Promise.race([
        this.recorder.stop(),
        new Promise<void>((_, rej) => setTimeout(() => rej(new Error('stop timeout')), 4000)),
      ]);
    } catch { /* timeout or error — uri might still be valid */ }
    // Release AFTER we have the URI captured above — release() may clear internal state.
    try { this.recorder.release?.(); } catch { /* ignore */ }
    this.recorder = null;
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
    try {
      const info = await FileSystem.getInfoAsync(uri);
      const fileSize = info.exists ? (info.size ?? 0) : 0;
      console.log(`[Listen] Clip: exists=${info.exists}, size=${fileSize}B, uri=${uri.slice(-40)}`);

      if (!info.exists || fileSize < 1_000) {
        // File missing or almost empty — save placeholder so session appears in Listen tab
        await enqueueTranscript('[Voice clip recorded — audio file was empty]', 'passive', false, sessionId);
        return;
      }

      const text = await transcribeAudioFile(uri);
      console.log(`[Listen] Whisper: ${text ? `${text.split(/\s+/).length}w` : 'null'}`);

      if (text && text.split(/\s+/).length >= 3) {
        this.transcriptAccumulator.push(text);
        await enqueueTranscript(text, 'passive', false, sessionId);
        this.patch({ wordsHeard: this.state.wordsHeard + text.split(/\s+/).length });
        void import('../processing/extract').then(({ processQueue }) =>
          processQueue(undefined, 1),
        ).catch(() => {});
      } else {
        // Whisper unavailable or audio too short — always save something so session shows up
        const note = text
          ? `[Voice clip — too short to capture: "${text}"]`
          : `[Voice clip — ${fileSize}B recorded, transcription unavailable (check OpenAI key in Settings)]`;
        await enqueueTranscript(note, 'passive', false, sessionId);
      }
    } catch (e) {
      console.error('[Listen] transcribeAndProcess error:', e);
      // Last-resort save so session is never silently lost
      try { await enqueueTranscript('[Voice clip — processing error]', 'passive', false, sessionId); } catch { /* ignore */ }
    }
    FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
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
