import { setAudioModeAsync, requestRecordingPermissionsAsync } from 'expo-audio';
import {
  ExpoSpeechRecognitionModule,
  type ExpoSpeechRecognitionErrorEvent,
  type ExpoSpeechRecognitionResultEvent,
} from 'expo-speech-recognition';
import * as Crypto from 'expo-crypto';
import { config } from '../config';
import { enqueueTranscript } from '../processing/extract';
import { acquireMic, releaseMic } from './micCoordinator';
import { resolveSpeechMode } from '../voice/onDeviceSpeech';

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
  /** True when this session is a one-shot "hold to talk" capture (not Listen mode). */
  quickCapture: boolean;
}

class PassiveListenerManager {
  private state: PassiveListenerState = {
    status: 'off', wordsHeard: 0, sessionStartedAt: null,
    recordingSeconds: 0, secondsUntilNextBatch: 0,
    mode: 'none', noApiKey: false, noMicAccess: false, quickCapture: false,
  };
  private stateListeners: Array<(s: PassiveListenerState) => void> = [];
  // Periodically flushes the on-device transcript buffer into a capture.
  private batchTimer: ReturnType<typeof setInterval> | null = null;
  private secondTimer: ReturnType<typeof setInterval> | null = null;
  private active = false;
  private meetingMode = false;
  private onDeviceReady = false; // whether an on-device model is ready for deviceSpeechLocale
  private deviceSpeechLocale = 'en-US';
  private deviceSpeechFatalError = false;
  private deviceSpeechSubscriptions: Array<{ remove(): void }> = [];
  private voiceBuffer: string[] = [];
  private voiceRestartTimer: ReturnType<typeof setTimeout> | null = null;
  private transcriptAccumulator: string[] = [];
  // Latest non-final on-device result. Only tracked when interimResults is on
  // (hold-to-talk / quickCapture), used as a fallback for utterances too short
  // to ever emit a "final" before the user releases.
  private deviceLastInterim = '';
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
  get usesOnDeviceSTT(): boolean { return true; }

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

  async start(options?: { meetingMode?: boolean; quickCapture?: boolean }): Promise<void> {
    if (this.state.status !== 'off') return;
    // Take the single recognizer so the wake-word listener yields while Listen mode runs.
    acquireMic('listen');
    // quickCapture (hold-to-talk) behaves like a titleless meeting: accumulate only.
    this.meetingMode = (options?.meetingMode ?? false) || (options?.quickCapture ?? false);
    this.patch({ status: 'starting', wordsHeard: 0, sessionStartedAt: Date.now(), recordingSeconds: 0, quickCapture: options?.quickCapture ?? false });
    this.transcriptAccumulator = [];
    this.deviceLastInterim = '';
    this.sessionId = Crypto.randomUUID();
    this.active = true;
    // Request microphone permission explicitly — prepareToRecordAsync() throws silently if denied.
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        this.patch({ status: 'off', sessionStartedAt: null, noMicAccess: true });
        this.active = false;
        releaseMic('listen');
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

    // Consent signal when listening starts
    try {
      const Haptics = await import('expo-haptics');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch { /* haptics not supported on this device */ }

    // Load the user's spoken-language locale for on-device recognition.
    this.deviceSpeechLocale = 'en-US';
    try {
      const { getDatabase } = await import('../db');
      const { getOnDeviceSpeechLocale, getUserProfile } = await import('../db/userProfile');
      const db = await getDatabase();
      const profile = await getUserProfile(db);
      this.deviceSpeechLocale = getOnDeviceSpeechLocale(profile);
    } catch { /* non-critical */ }

    // LUCY transcribes entirely on-device (Apple SFSpeechRecognizer / Android
    // SpeechRecognizer). There is no cloud transcription fallback.
    // CRITICAL: release any expo-audio recording session first. SFSpeechRecognizer
    // starts its own AVAudioEngine, and if expo-audio still owns the AVAudioSession
    // in record mode the engine raises an uncatchable exception → crash.
    try { await setAudioModeAsync({ allowsRecording: false }); } catch { /* non-fatal */ }

    let permGranted = false;
    let recognitionAvailable = false;
    let onDeviceSupported = false;
    try {
      const microphonePermission = await ExpoSpeechRecognitionModule.requestMicrophonePermissionsAsync();
      permGranted = microphonePermission.granted;
      recognitionAvailable = ExpoSpeechRecognitionModule.isRecognitionAvailable();
      onDeviceSupported = ExpoSpeechRecognitionModule.supportsOnDeviceRecognition();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.failDeviceSpeech(`On-device speech recognition could not initialize. ${message}`);
      return;
    }
    if (!permGranted) {
      await this.failDeviceSpeech(
        'Microphone permission is not available. Open Settings → Apps → LUCY → Microphone and enable it.',
      );
      return;
    }
    if (!recognitionAvailable) {
      await this.failDeviceSpeech(
        'Speech recognition is unavailable on this device. On iPhone, enable Siri & Dictation in Settings.',
      );
      return;
    }
    // Pure ambient Listen requires on-device (it must never stream to the cloud). An explicit meeting /
    // hold-to-talk may proceed without it and use the OS recognizer so it still transcribes.
    if (!onDeviceSupported && !this.meetingMode) {
      await this.failDeviceSpeech(
        'This device does not currently support private on-device speech recognition.',
      );
      return;
    }
    // Prefer on-device. An explicit meeting / hold-to-talk may fall back to the OS recognizer when no
    // on-device model is installed yet (so it still transcribes, and the model downloads to self-heal).
    // Pure ambient Listen stays STRICTLY on-device — it must never stream background audio to the cloud.
    try {
      const mode = await resolveSpeechMode(this.deviceSpeechLocale);
      this.onDeviceReady = mode.onDevice;
    } catch { this.onDeviceReady = false; }
    this.patch({ mode: 'stt', noApiKey: false });
    this.configureDeviceSpeechListeners();
    if (!this.startDeviceSpeech()) return;
    this.batchTimer = setInterval(() => void this.flushVoiceBuffer(), config.passiveListenBatchMinutes * 60 * 1000);
    this.patch({ status: 'listening' });
  }

  private configureDeviceSpeechListeners(): void {
    this.clearDeviceSpeechListeners();
    this.deviceSpeechFatalError = false;
    this.deviceSpeechSubscriptions = [
      ExpoSpeechRecognitionModule.addListener('result', (event: ExpoSpeechRecognitionResultEvent) => {
        const text = event.results[0]?.transcript.trim() ?? '';
        if (!text) return;
        if (!event.isFinal) {
          // Only meaningful when interimResults is on (quickCapture). Keeps the
          // latest partial so a short utterance isn't lost if no final lands.
          this.deviceLastInterim = text;
          return;
        }
        this.deviceLastInterim = '';
        this.voiceBuffer.push(text);
        this.transcriptAccumulator.push(text);
        this.patch({ wordsHeard: this.state.wordsHeard + text.split(/\s+/).length });
      }),
      ExpoSpeechRecognitionModule.addListener('error', (event: ExpoSpeechRecognitionErrorEvent) => {
        console.error(`[Listen] On-device speech error ${event.error}: ${event.message}`);
        if (!this.active || event.error === 'aborted' || event.error === 'no-speech') return;
        this.deviceSpeechFatalError = true;
        void this.failDeviceSpeech(
          'Private listening was interrupted. If this is a new device, on-device voice may still be downloading — please try again in a moment.',
        );
      }),
      ExpoSpeechRecognitionModule.addListener('end', () => {
        if (this.active && !this.deviceSpeechFatalError) {
          this.voiceRestartTimer = setTimeout(() => this.startDeviceSpeech(), 300);
        }
      }),
    ];
  }

  private clearDeviceSpeechListeners(): void {
    for (const subscription of this.deviceSpeechSubscriptions) subscription.remove();
    this.deviceSpeechSubscriptions = [];
  }

  private startDeviceSpeech(): boolean {
    if (!this.active) return false;
    try {
      ExpoSpeechRecognitionModule.start({
        lang: this.deviceSpeechLocale,
        // Hold-to-talk needs interims as a fallback for short utterances; Listen
        // mode stays final-only to avoid noisy partial captures.
        interimResults: this.state.quickCapture,
        maxAlternatives: 1,
        continuous: true,
        // Ambient Listen stays strictly on-device; an explicit meeting falls back to the OS recognizer
        // when no on-device model is installed yet, so it still transcribes (iOS stays on-device).
        requiresOnDeviceRecognition: this.meetingMode ? this.onDeviceReady : true,
        addsPunctuation: true,
        // Explicit audio session config (the library's documented default) so the
        // AVAudioSession category/mode are set deterministically and don't collide
        // with whatever state a prior recording left behind.
        iosCategory: {
          category: 'playAndRecord',
          categoryOptions: ['defaultToSpeaker', 'allowBluetooth'],
          mode: 'measurement',
        },
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deviceSpeechFatalError = true;
      void this.failDeviceSpeech(`Could not start on-device transcription. ${message}`);
      return false;
    }
  }

  private async failDeviceSpeech(message: string): Promise<void> {
    if (!this.active && this.state.status === 'off') return;
    this.active = false;
    clearInterval(this.batchTimer!);
    clearInterval(this.secondTimer!);
    clearTimeout(this.voiceRestartTimer!);
    this.batchTimer = null;
    this.secondTimer = null;
    this.voiceRestartTimer = null;
    try { ExpoSpeechRecognitionModule.abort(); } catch { /* native recognizer may already be stopped */ }
    this.clearDeviceSpeechListeners();
    this.patch({ status: 'off', mode: 'none', sessionStartedAt: null });
    this.sessionId = null;
    releaseMic('listen');
    const { Alert } = await import('react-native');
    Alert.alert('On-device transcription unavailable', message, [{ text: 'OK' }]);
  }

  private async flushVoiceBuffer(): Promise<void> {
    if (this.voiceBuffer.length === 0) return;
    const text = this.voiceBuffer.join(' ').trim();
    this.voiceBuffer = [];
    // In meeting / hold-to-talk (quickCapture) mode we only accumulate the
    // transcript (transcriptAccumulator, populated by the result listener); the
    // caller persists it once. Enqueuing here too would create a duplicate
    // "Listen" capture alongside the meeting/voice entry.
    if (this.meetingMode) return;
    if (text.split(/\s+/).length >= 5) { try { await enqueueTranscript(text, 'passive', false, this.sessionId); } catch { /* non-critical */ } }
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
    const quick = this.state.quickCapture;
    try { ExpoSpeechRecognitionModule.stop(); } catch { /* ignore */ }
    // Hold-to-talk waits a touch longer for a trailing final to land.
    await new Promise<void>((resolve) => setTimeout(resolve, quick ? 900 : 400));
    this.clearDeviceSpeechListeners();
    await this.flushVoiceBuffer();
    // Short hold-to-talk utterances may never emit a "final" — fall back to the
    // last interim so the capture isn't silently lost.
    if (quick && this.transcriptAccumulator.length === 0 && this.deviceLastInterim.trim()) {
      this.transcriptAccumulator.push(this.deviceLastInterim.trim());
    }
    try { await setAudioModeAsync({ allowsRecording: false }); } catch { /* non-fatal */ }
    this.sessionId = null;
    this.patch({ status: 'off', sessionStartedAt: null, quickCapture: false });
    releaseMic('listen');
  }
}

export const passiveListener = new PassiveListenerManager();
