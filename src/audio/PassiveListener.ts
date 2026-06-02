import { RecordingPresets, setAudioModeAsync } from 'expo-audio';
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
  /** Seconds elapsed since recording started (batch mode only). Updates every second. */
  recordingSeconds: number;
  /** Whether this session uses on-device STT or batch+Whisper */
  mode: 'stt' | 'batch' | 'none';
  /** True when API key is missing and word count will never update */
  noApiKey: boolean;
}

class PassiveListenerManager {
  private state: PassiveListenerState = {
    status: 'off', wordsHeard: 0, sessionStartedAt: null,
    recordingSeconds: 0, mode: 'none', noApiKey: false,
  };
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
      // 10-minute batches: large enough to capture a meaningful chunk,
      // short enough to process promptly. Stopping early triggers immediate processing.
      this.batchTimer = setInterval(() => void this.rotateBatch(), 10 * 60 * 1000);
      // Tick recording seconds every second so the UI can show progress
      this.secondTimer = setInterval(() => {
        this.patch({ recordingSeconds: this.state.recordingSeconds + 1 });
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
    try {
      this.recorder = new AudioRecorderClass(RecordingPresets.HIGH_QUALITY);
      await this.recorder.prepareToRecordAsync();
      this.recorder.record();
    } catch { this.patch({ status: 'off', sessionStartedAt: null }); this.active = false; }
  }

  private async rotateBatch(): Promise<void> {
    if (!this.recorder || !this.active) return;
    try {
      await this.recorder.stop();
      const uri = this.recorder.uri;
      this.recorder.release?.();
      this.recorder = null;
      if (uri) void this.transcribeAndProcess(uri);
    } catch { /* non-critical */ }
    if (this.active) await this.startRecordingBatch();
  }

  private async transcribeAndProcess(uri: string): Promise<void> {
    try {
      const text = await transcribeAudioFile(uri);
      if (text && text.split(/\s+/).length >= 5) {
        this.transcriptAccumulator.push(text); // accumulate for Meeting Mode
        await enqueueTranscript(text, 'passive', false, this.sessionId);
        this.patch({ wordsHeard: this.state.wordsHeard + text.split(/\s+/).length });
      }
    } catch { /* non-critical */ }
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
    if (this.recorder) {
      try { await this.recorder.stop(); const uri = this.recorder.uri; this.recorder.release?.(); this.recorder = null; if (uri) await this.transcribeAndProcess(uri); } catch { /* ignore */ }
    }
    try { await setAudioModeAsync({ allowsRecording: false }); } catch { /* non-fatal */ }
    this.sessionId = null;
    this.patch({ status: 'off', sessionStartedAt: null });
  }
}

export const passiveListener = new PassiveListenerManager();
