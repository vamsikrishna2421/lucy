import { setAudioModeAsync } from 'expo-audio';
import { config } from '../config';
import { getDatabase } from '../db';
import { insertMusicCapture, markMusicCaptureNotified } from '../db/musicCaptures';
import { enqueueTranscript } from '../processing/extract';
import { sendGuardianNotification } from '../processing/notifications';
import { detectMusic } from './MusicDetector';

// @jamsch/expo-speech-recognition wraps SFSpeechRecognizer (iOS) and
// Android SpeechRecognizer. Loaded dynamically — graceful no-op on builds
// that predate the package being compiled into the native binary.
let SR: SpeechRecognitionModule | null = null;
try {
  SR = require('@jamsch/expo-speech-recognition') as SpeechRecognitionModule;
} catch {
  // Native module not available in this build.
}

interface SpeechRecognitionModule {
  ExpoSpeechRecognitionModule: {
    start(options: { lang: string; continuous: boolean; interimResults: boolean }): void;
    stop(): void;
    abort(): void;
    addListener(
      event: 'result' | 'end' | 'error' | 'start',
      listener: (e: SREvent) => void,
    ): { remove(): void };
  };
}

interface SREvent {
  results?: Array<{ transcript: string; isFinal: boolean }>;
  error?: string;
  message?: string;
}

export type ListeningStatus = 'off' | 'starting' | 'listening' | 'stopping';

export interface PassiveListenerState {
  status: ListeningStatus;
  wordsHeard: number;
  songsDetected: number;
  sessionStartedAt: number | null;
}

class PassiveListenerManager {
  private state: PassiveListenerState = {
    status: 'off',
    wordsHeard: 0,
    songsDetected: 0,
    sessionStartedAt: null,
  };

  private listeners: Array<(s: PassiveListenerState) => void> = [];
  private transcriptBuffer: string[] = [];
  private batchTimer: ReturnType<typeof setInterval> | null = null;
  private musicTimer: ReturnType<typeof setInterval> | null = null;
  private sessionRestartTimer: ReturnType<typeof setTimeout> | null = null;
  private srListeners: Array<{ remove(): void }> = [];
  private active = false;

  subscribe(fn: (s: PassiveListenerState) => void): () => void {
    this.listeners.push(fn);
    fn({ ...this.state });
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  getState(): PassiveListenerState {
    return { ...this.state };
  }

  get isAvailable(): boolean {
    return SR !== null;
  }

  private emit(): void {
    for (const fn of this.listeners) fn({ ...this.state });
  }

  private patch(patch: Partial<PassiveListenerState>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  async start(): Promise<void> {
    if (!SR || this.state.status !== 'off') return;

    this.patch({ status: 'starting', wordsHeard: 0, songsDetected: 0, sessionStartedAt: Date.now() });
    this.active = true;

    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    } catch { /* non-fatal */ }

    this.attachSrListeners();
    this.startSrSession();

    const batchMs = config.passiveListenBatchMinutes * 60 * 1000;
    const musicMs = config.passiveMusicSampleIntervalMinutes * 60 * 1000;
    this.batchTimer = setInterval(() => void this.flushBatch(), batchMs);
    this.musicTimer = setInterval(() => void this.sampleMusic(), musicMs);

    this.patch({ status: 'listening' });
  }

  private attachSrListeners(): void {
    if (!SR) return;
    const mod = SR.ExpoSpeechRecognitionModule;

    this.srListeners.push(
      mod.addListener('result', (e) => {
        for (const result of e.results ?? []) {
          if (result.isFinal && result.transcript.trim()) {
            this.transcriptBuffer.push(result.transcript.trim());
            const words = result.transcript.trim().split(/\s+/).length;
            this.patch({ wordsHeard: this.state.wordsHeard + words });
          }
        }
      }),
    );

    this.srListeners.push(
      mod.addListener('end', () => {
        // SFSpeechRecognizer ends sessions after ~1 min — restart automatically.
        if (this.active) {
          this.sessionRestartTimer = setTimeout(() => this.startSrSession(), 300);
        }
      }),
    );

    this.srListeners.push(
      mod.addListener('error', () => {
        if (this.active) {
          this.sessionRestartTimer = setTimeout(() => this.startSrSession(), 2000);
        }
      }),
    );
  }

  private startSrSession(): void {
    if (!SR || !this.active) return;
    try {
      SR.ExpoSpeechRecognitionModule.start({
        lang: 'en-US',
        continuous: true,
        interimResults: false,
      });
    } catch {
      if (this.active) {
        this.sessionRestartTimer = setTimeout(() => this.startSrSession(), 3000);
      }
    }
  }

  private async flushBatch(): Promise<void> {
    if (this.transcriptBuffer.length === 0) return;
    const text = this.transcriptBuffer.join(' ').trim();
    this.transcriptBuffer = [];
    if (text.split(/\s+/).length < 5) return;
    try {
      await enqueueTranscript(text, 'passive');
    } catch { /* non-critical */ }
  }

  private async sampleMusic(): Promise<void> {
    const match = await detectMusic();
    if (!match) return;
    try {
      const db = await getDatabase();
      await insertMusicCapture(db, match.title, match.artist, match.album, match.confidence, match.spotifyTrackId, match.spotifyUrl, match.appleMusicUrl);
      this.patch({ songsDetected: this.state.songsDetected + 1 });
      await sendGuardianNotification(
        `"${match.title}" by ${match.artist} — caught you humming. Want to listen?`,
        { kind: 'music', title: match.title, artist: match.artist, spotifyUrl: match.spotifyUrl },
      );
      const row = await db.getFirstAsync<{ id: number }>(
        `SELECT id FROM music_captures WHERE title = ? AND artist = ? ORDER BY created_at DESC LIMIT 1`,
        match.title, match.artist,
      );
      if (row) await markMusicCaptureNotified(db, row.id);
    } catch { /* non-critical */ }
  }

  async stop(): Promise<void> {
    if (this.state.status === 'off') return;
    this.patch({ status: 'stopping' });
    this.active = false;

    clearInterval(this.batchTimer!);
    clearInterval(this.musicTimer!);
    clearTimeout(this.sessionRestartTimer!);
    this.batchTimer = null;
    this.musicTimer = null;
    this.sessionRestartTimer = null;

    for (const sub of this.srListeners) sub.remove();
    this.srListeners = [];

    if (SR) {
      try { SR.ExpoSpeechRecognitionModule.stop(); } catch { /* ignore */ }
    }

    await this.flushBatch();

    try {
      await setAudioModeAsync({ allowsRecording: false });
    } catch { /* non-fatal */ }

    this.patch({ status: 'off', sessionStartedAt: null });
  }
}

export const passiveListener = new PassiveListenerManager();
