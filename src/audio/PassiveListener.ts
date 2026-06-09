import { RecordingPresets, setAudioModeAsync, requestRecordingPermissionsAsync } from 'expo-audio';
import {
  ExpoSpeechRecognitionModule,
  type ExpoSpeechRecognitionErrorEvent,
  type ExpoSpeechRecognitionResultEvent,
} from 'expo-speech-recognition';
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
  /** Batch duration in seconds — shorter = more responsive, more Whisper calls. */
  private static readonly BATCH_SECONDS = 30; // was 10 min; 30s = <45s end-to-end

  private state: PassiveListenerState = {
    status: 'off', wordsHeard: 0, sessionStartedAt: null,
    recordingSeconds: 0, secondsUntilNextBatch: PassiveListenerManager.BATCH_SECONDS,
    mode: 'none', noApiKey: false, noMicAccess: false, quickCapture: false,
  };
  private batchStartedAt = 0;
  private stateListeners: Array<(s: PassiveListenerState) => void> = [];
  private recorder: RecorderInstance | null = null;
  private batchTimer: ReturnType<typeof setInterval> | null = null;
  private secondTimer: ReturnType<typeof setInterval> | null = null;
  private active = false;
  private meetingMode = false;
  private languageHint: string | null = null; // ISO-639-1 code for primary language
  private deviceSpeechLocale = 'en-US';
  private deviceSpeechFatalError = false;
  private deviceSpeechSubscriptions: Array<{ remove(): void }> = [];
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
    // quickCapture (hold-to-talk) behaves like a titleless meeting: accumulate only.
    this.meetingMode = (options?.meetingMode ?? false) || (options?.quickCapture ?? false);
    this.patch({ status: 'starting', wordsHeard: 0, sessionStartedAt: Date.now(), recordingSeconds: 0, quickCapture: options?.quickCapture ?? false });
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

    // Consent signal when listening starts
    try {
      const Haptics = await import('expo-haptics');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch { /* haptics not supported on this device */ }

    // Load user preferences: language hint and transcription engine preference
    let preferDeviceSTT = false;
    this.languageHint = null;
    this.deviceSpeechLocale = 'en-US';
    try {
      const { getDatabase } = await import('../db');
      const { getOnDeviceSpeechLocale, getUserProfile, getWhisperLanguageHint } = await import('../db/userProfile');
      const db = await getDatabase();
      const profile = await getUserProfile(db);
      this.languageHint = getWhisperLanguageHint(profile);
      this.deviceSpeechLocale = getOnDeviceSpeechLocale(profile);
      preferDeviceSTT = profile.transcriptionEngine === 'device';
    } catch { /* non-critical */ }

    let useDeviceSpeech = preferDeviceSTT;

    // Check if API key is present (batch mode needs it to count words)
    let noApiKey = false;
    if (!useDeviceSpeech) {
      try {
        const key = await getRemoteOpenAIKey();
        noApiKey = !key;
      } catch { noApiKey = true; }
    }

    // Hold-to-talk (quickCapture) must work out of the box. If Whisper is the
    // chosen engine but there's no OpenAI key, transparently fall back to free
    // on-device speech recognition so the mic still produces text. (Listen mode
    // intentionally stays in batch mode so the no-key banner can prompt the user.)
    if (this.state.quickCapture && noApiKey && !useDeviceSpeech) {
      useDeviceSpeech = true;
      noApiKey = false;
    }

    if (useDeviceSpeech) {
      // CRITICAL: release any expo-audio recording session left active by a prior
      // Whisper/batch run. SFSpeechRecognizer starts its own AVAudioEngine, and if
      // expo-audio still owns the AVAudioSession in record mode the engine raises an
      // uncatchable Objective-C exception → immediate app crash. Deactivating first
      // hands the session cleanly to the speech recognizer.
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
        await this.failDeviceSpeech(`On-device speech recognition could not initialize. ${message} Switch Voice transcription engine to OpenAI Whisper.`);
        return;
      }
      if (!permGranted) {
        await this.failDeviceSpeech(
          'Microphone permission is not available. Open iPhone Settings → Apps → LUCY → Microphone and enable it.',
        );
        return;
      }
      if (!recognitionAvailable) {
        await this.failDeviceSpeech(
          'Apple speech recognition is unavailable on this device. Enable Siri & Dictation, or switch Voice transcription engine to OpenAI Whisper.',
        );
        return;
      }
      if (!onDeviceSupported) {
        await this.failDeviceSpeech(
          'This device does not currently support private on-device speech recognition. Switch Voice transcription engine to OpenAI Whisper.',
        );
        return;
      }
      // Confirm the chosen locale has an on-device model installed. Forcing
      // requiresOnDeviceRecognition for an uninstalled locale can fail hard, so we
      // fall back to en-US (always installed on iOS) when the locale isn't ready.
      try {
        const supported = await ExpoSpeechRecognitionModule.getSupportedLocales({});
        const installed = (supported?.installedLocales ?? []) as string[];
        if (installed.length > 0 && !installed.includes(this.deviceSpeechLocale)) {
          console.warn(`[Listen] Locale ${this.deviceSpeechLocale} not installed on-device; falling back to en-US`);
          this.deviceSpeechLocale = 'en-US';
        }
      } catch { /* getSupportedLocales not critical — proceed with chosen locale */ }
      this.patch({ mode: 'stt', noApiKey: false });
      this.configureDeviceSpeechListeners();
      if (!this.startDeviceSpeech()) return;
      this.batchTimer = setInterval(() => void this.flushVoiceBuffer(), config.passiveListenBatchMinutes * 60 * 1000);
    } else {
      this.patch({ mode: 'batch', noApiKey });
      // Batch mode owns the Expo Audio session and can continue in the background.
      try { await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, allowsBackgroundRecording: true }); } catch { /* non-fatal */ }
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

  private configureDeviceSpeechListeners(): void {
    this.clearDeviceSpeechListeners();
    this.deviceSpeechFatalError = false;
    this.deviceSpeechSubscriptions = [
      ExpoSpeechRecognitionModule.addListener('result', (event: ExpoSpeechRecognitionResultEvent) => {
        if (!event.isFinal) return;
        const text = event.results[0]?.transcript.trim() ?? '';
        if (!text) return;
        this.voiceBuffer.push(text);
        this.transcriptAccumulator.push(text);
        this.patch({ wordsHeard: this.state.wordsHeard + text.split(/\s+/).length });
      }),
      ExpoSpeechRecognitionModule.addListener('error', (event: ExpoSpeechRecognitionErrorEvent) => {
        console.error(`[Listen] On-device speech error ${event.error}: ${event.message}`);
        if (!this.active || event.error === 'aborted' || event.error === 'no-speech') return;
        this.deviceSpeechFatalError = true;
        void this.failDeviceSpeech(
          `On-device transcription failed (${event.error}). ${event.message || 'Switch Voice transcription engine to OpenAI Whisper and try again.'}`,
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
        interimResults: false,
        maxAlternatives: 1,
        continuous: true,
        requiresOnDeviceRecognition: true,
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
    const { Alert } = await import('react-native');
    Alert.alert('On-device transcription unavailable', message, [{ text: 'OK' }]);
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
    if (this.state.mode === 'stt') {
      try { ExpoSpeechRecognitionModule.stop(); } catch { /* ignore */ }
      await new Promise<void>((resolve) => setTimeout(resolve, 400));
      this.clearDeviceSpeechListeners();
      await this.flushVoiceBuffer();
    }
    const uri = await this.stopRecorder();
    if (uri) {
      await this.transcribeAndProcess(uri);
    } else if (this.sessionId && this.state.mode === 'batch') {
      // Recorder never produced audio (permission denied or init error) — save marker
      try {
        await enqueueTranscript('[Listen session — no audio recorded. Check microphone permission in Settings → Privacy → Microphone.]', 'passive', false, this.sessionId);
      } catch { /* ignore */ }
    }
    try { await setAudioModeAsync({ allowsRecording: false }); } catch { /* non-fatal */ }
    this.sessionId = null;
    this.patch({ status: 'off', sessionStartedAt: null, quickCapture: false });
  }
}

export const passiveListener = new PassiveListenerManager();
