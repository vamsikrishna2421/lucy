import { setAudioModeAsync } from 'expo-audio';
import { config } from '../config';
import { getDatabase } from '../db';
import { insertMusicCapture, markMusicCaptureNotified } from '../db/musicCaptures';
import { enqueueTranscript } from '../processing/extract';
import { sendGuardianNotification } from '../processing/notifications';
import { detectMusic } from './MusicDetector';

// @react-native-voice/voice requires a native build — loaded dynamically so the
// app does not crash on builds that predate the passive listening feature.
let Voice: VoiceModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  Voice = (require('@react-native-voice/voice') as { default: VoiceModule }).default;
} catch {
  // Native module not compiled into this build yet.
}

interface VoiceModule {
  onSpeechResults: ((e: { value?: string[] }) => void) | null;
  onSpeechPartialResults: ((e: { value?: string[] }) => void) | null;
  onSpeechEnd: ((e: unknown) => void) | null;
  onSpeechError: ((e: unknown) => void) | null;
  start(locale: string): Promise<void>;
  stop(): Promise<void>;
  destroy(): Promise<void>;
  isAvailable(): Promise<0 | 1>;
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
  private sessionActive = false;

  subscribe(fn: (s: PassiveListenerState) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  getState(): PassiveListenerState {
    return { ...this.state };
  }

  get isAvailable(): boolean {
    return Voice !== null;
  }

  private emit() {
    for (const fn of this.listeners) fn({ ...this.state });
  }

  private updateState(patch: Partial<PassiveListenerState>) {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  async start(): Promise<void> {
    if (!Voice) return;
    if (this.state.status !== 'off') return;

    this.updateState({ status: 'starting', wordsHeard: 0, songsDetected: 0, sessionStartedAt: Date.now() });

    try {
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
    } catch { /* non-fatal */ }

    Voice.onSpeechResults = (e) => {
      const words = (e.value ?? []).join(' ').trim();
      if (words) {
        this.transcriptBuffer.push(words);
        this.updateState({ wordsHeard: this.state.wordsHeard + words.split(/\s+/).length });
      }
    };

    Voice.onSpeechPartialResults = (e) => {
      // Partial results give live feedback — not stored, just used for word count display.
      const words = (e.value ?? []).join(' ').trim().split(/\s+/).length;
      this.updateState({ wordsHeard: this.state.wordsHeard + words });
    };

    Voice.onSpeechEnd = () => {
      if (this.sessionActive) {
        this.scheduleSessionRestart();
      }
    };

    Voice.onSpeechError = () => {
      if (this.sessionActive) {
        this.scheduleSessionRestart(2000);
      }
    };

    this.sessionActive = true;
    await this.startVoiceSession();

    const batchMs = config.passiveListenBatchMinutes * 60 * 1000;
    const musicMs = config.passiveMusicSampleIntervalMinutes * 60 * 1000;

    this.batchTimer = setInterval(() => void this.flushBatch(), batchMs);
    this.musicTimer = setInterval(() => void this.sampleMusic(), musicMs);

    this.updateState({ status: 'listening' });
  }

  private async startVoiceSession(): Promise<void> {
    if (!Voice || !this.sessionActive) return;
    try {
      await Voice.start('en-US');
      // iOS SFSpeechRecognizer has a ~1-minute limit; restart before it cuts off.
      this.sessionRestartTimer = setTimeout(() => {
        if (this.sessionActive) {
          Voice!.stop().catch(() => {});
        }
      }, 50_000);
    } catch {
      this.scheduleSessionRestart(3000);
    }
  }

  private scheduleSessionRestart(delayMs = 500): void {
    clearTimeout(this.sessionRestartTimer!);
    this.sessionRestartTimer = setTimeout(() => void this.startVoiceSession(), delayMs);
  }

  private async flushBatch(): Promise<void> {
    if (this.transcriptBuffer.length === 0) return;
    const text = this.transcriptBuffer.join(' ').trim();
    this.transcriptBuffer = [];
    if (text.split(/\s+/).length < 5) return; // skip near-empty batches
    try {
      await enqueueTranscript(text, 'passive');
    } catch { /* non-critical */ }
  }

  private async sampleMusic(): Promise<void> {
    const match = await detectMusic();
    if (!match) return;

    try {
      const db = await getDatabase();
      await insertMusicCapture(
        db,
        match.title,
        match.artist,
        match.album,
        match.confidence,
        match.spotifyTrackId,
        match.spotifyUrl,
        match.appleMusicUrl,
      );
      this.updateState({ songsDetected: this.state.songsDetected + 1 });

      const notifMsg = `"${match.title}" by ${match.artist} — I caught you humming. Want to listen?`;
      await sendGuardianNotification(notifMsg, { kind: 'music', title: match.title, artist: match.artist, spotifyUrl: match.spotifyUrl });

      const row = await db.getFirstAsync<{ id: number }>(
        `SELECT id FROM music_captures WHERE title = ? AND artist = ? ORDER BY created_at DESC LIMIT 1`,
        match.title,
        match.artist,
      );
      if (row) await markMusicCaptureNotified(db, row.id);
    } catch { /* non-critical */ }
  }

  async stop(): Promise<void> {
    if (this.state.status === 'off') return;
    this.updateState({ status: 'stopping' });
    this.sessionActive = false;

    clearInterval(this.batchTimer!);
    clearInterval(this.musicTimer!);
    clearTimeout(this.sessionRestartTimer!);
    this.batchTimer = null;
    this.musicTimer = null;
    this.sessionRestartTimer = null;

    await this.flushBatch();

    if (Voice) {
      try { await Voice.destroy(); } catch { /* ignore */ }
    }

    try {
      await setAudioModeAsync({ allowsRecording: false });
    } catch { /* non-fatal */ }

    this.updateState({ status: 'off', sessionStartedAt: null });
  }
}

export const passiveListener = new PassiveListenerManager();
