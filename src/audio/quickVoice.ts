/**
 * QuickVoice — one-shot voice capture for the bottom-nav mic button.
 *
 * Records a single utterance, transcribes it (on-device SFSpeechRecognizer or OpenAI
 * Whisper, per the user's setting), and returns the text. The caller saves it as a capture.
 *
 * Independent of PassiveListener (which owns the batch/meeting sessions) so the two
 * never fight over the audio session.
 */
import { RecordingPresets, setAudioModeAsync, requestRecordingPermissionsAsync } from 'expo-audio';
import { Platform } from 'react-native';
import { File as FSFile } from 'expo-file-system';
import {
  ExpoSpeechRecognitionModule,
  type ExpoSpeechRecognitionResultEvent,
} from 'expo-speech-recognition';
import { transcribeAudioFile } from './WhisperTranscriber';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const AudioModule = (require('expo-audio/build/AudioModule') as { default: { AudioRecorder: new (opts: unknown) => RecorderInstance } }).default;

type RecorderInstance = { prepareToRecordAsync(): Promise<void>; record(): void; stop(): Promise<void>; uri: string | null; release?: () => void };

function flattenPreset(preset: typeof RecordingPresets.HIGH_QUALITY): Record<string, unknown> {
  const base = { extension: preset.extension, sampleRate: preset.sampleRate, numberOfChannels: preset.numberOfChannels, bitRate: preset.bitRate, isMeteringEnabled: false };
  const platform = Platform.OS === 'ios' ? preset.ios : Platform.OS === 'android' ? preset.android : preset.web;
  return { ...base, ...(platform ?? {}) };
}

export type QuickVoiceStatus = 'idle' | 'recording' | 'transcribing';

class QuickVoiceManager {
  private status: QuickVoiceStatus = 'idle';
  private listeners: Array<(s: QuickVoiceStatus) => void> = [];
  private recorder: RecorderInstance | null = null;
  private useDevice = false;
  private languageHint: string | null = null;
  private deviceLocale = 'en-US';
  private deviceParts: string[] = [];
  private deviceSubs: Array<{ remove(): void }> = [];

  subscribe(fn: (s: QuickVoiceStatus) => void): () => void {
    this.listeners.push(fn);
    fn(this.status);
    return () => { this.listeners = this.listeners.filter((l) => l !== fn); };
  }
  private set(s: QuickVoiceStatus) { this.status = s; for (const l of this.listeners) l(s); }
  getStatus(): QuickVoiceStatus { return this.status; }

  async start(): Promise<boolean> {
    if (this.status !== 'idle') return false;
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) return false;
    } catch { /* proceed */ }

    // Load engine + language preference
    try {
      const { getDatabase } = await import('../db');
      const { getUserProfile, getWhisperLanguageHint, getOnDeviceSpeechLocale } = await import('../db/userProfile');
      const db = await getDatabase();
      const profile = await getUserProfile(db);
      this.useDevice = profile.transcriptionEngine === 'device';
      this.languageHint = getWhisperLanguageHint(profile);
      this.deviceLocale = getOnDeviceSpeechLocale(profile);
    } catch { /* defaults */ }

    try { await import('expo-haptics').then((H) => H.impactAsync(H.ImpactFeedbackStyle.Medium)).catch(() => {}); } catch { /* ignore */ }

    if (this.useDevice) {
      try {
        const mic = await ExpoSpeechRecognitionModule.requestMicrophonePermissionsAsync();
        if (!mic.granted || !ExpoSpeechRecognitionModule.isRecognitionAvailable()) { this.useDevice = false; }
      } catch { this.useDevice = false; }
    }

    if (this.useDevice) {
      this.deviceParts = [];
      try { await setAudioModeAsync({ allowsRecording: false }); } catch { /* ignore */ }
      this.deviceSubs = [
        ExpoSpeechRecognitionModule.addListener('result', (e: ExpoSpeechRecognitionResultEvent) => {
          if (!e.isFinal) return;
          const t = e.results[0]?.transcript?.trim() ?? '';
          if (t) this.deviceParts.push(t);
        }),
      ];
      try {
        ExpoSpeechRecognitionModule.start({
          lang: this.deviceLocale, interimResults: false, continuous: true,
          requiresOnDeviceRecognition: true, addsPunctuation: true,
          iosCategory: { category: 'playAndRecord', categoryOptions: ['defaultToSpeaker', 'allowBluetooth'], mode: 'measurement' },
        });
      } catch { this.cleanupDevice(); return false; }
      this.set('recording');
      return true;
    }

    // Whisper path: record audio
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      this.recorder = new AudioModule.AudioRecorder(flattenPreset(RecordingPresets.HIGH_QUALITY));
      await this.recorder.prepareToRecordAsync();
      this.recorder.record();
      this.set('recording');
      return true;
    } catch {
      this.recorder = null;
      return false;
    }
  }

  /** Stops recording and returns the transcribed text (or null). */
  async stop(): Promise<string | null> {
    if (this.status !== 'recording') return null;
    this.set('transcribing');
    try { await import('expo-haptics').then((H) => H.impactAsync(H.ImpactFeedbackStyle.Light)).catch(() => {}); } catch { /* ignore */ }

    if (this.useDevice) {
      try { ExpoSpeechRecognitionModule.stop(); } catch { /* ignore */ }
      await new Promise((r) => setTimeout(r, 600)); // let final results land
      this.cleanupDevice();
      const text = this.deviceParts.join(' ').trim();
      this.set('idle');
      return text || null;
    }

    // Whisper path
    const rec = this.recorder;
    this.recorder = null;
    let uri: string | null = null;
    if (rec) {
      try {
        await Promise.race([rec.stop(), new Promise<void>((_, rej) => setTimeout(() => rej(new Error('stop timeout')), 5000))]);
      } catch { /* ignore */ }
      uri = rec.uri ?? null;
      try { rec.release?.(); } catch { /* ignore */ }
    }
    try { await setAudioModeAsync({ allowsRecording: false }); } catch { /* ignore */ }

    if (!uri) { this.set('idle'); return null; }
    try {
      const file = new FSFile(uri);
      if (!file.exists || (file.size ?? 0) < 1000) { try { file.delete(); } catch { /* ignore */ } this.set('idle'); return null; }
      const text = await transcribeAudioFile(uri, this.languageHint);
      try { new FSFile(uri).delete(); } catch { /* ignore */ }
      this.set('idle');
      return text?.trim() || null;
    } catch {
      this.set('idle');
      return null;
    }
  }

  private cleanupDevice() {
    for (const s of this.deviceSubs) { try { s.remove(); } catch { /* ignore */ } }
    this.deviceSubs = [];
  }
}

export const quickVoice = new QuickVoiceManager();
