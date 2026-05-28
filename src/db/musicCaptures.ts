import type { SQLiteDatabase } from 'expo-sqlite';

export interface MusicCaptureRow {
  id: number;
  created_at: string;
  title: string;
  artist: string;
  album: string | null;
  acr_confidence: number | null;
  spotify_track_id: string | null;
  spotify_url: string | null;
  apple_music_url: string | null;
  status: 'new' | 'notified' | 'dismissed';
}

export async function insertMusicCapture(
  db: SQLiteDatabase,
  title: string,
  artist: string,
  album: string | null,
  acrConfidence: number | null,
  spotifyTrackId: string | null,
  spotifyUrl: string | null,
  appleMusicUrl: string | null,
): Promise<void> {
  const recent = await db.getFirstAsync<{ id: number }>(
    `SELECT id FROM music_captures
     WHERE title = ? AND artist = ? AND created_at > datetime('now', '-1 hour')
     LIMIT 1`,
    title,
    artist,
  );
  if (recent) return;
  await db.runAsync(
    `INSERT INTO music_captures (title, artist, album, acr_confidence, spotify_track_id, spotify_url, apple_music_url)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    title,
    artist,
    album,
    acrConfidence,
    spotifyTrackId,
    spotifyUrl,
    appleMusicUrl,
  );
}

export async function listNewMusicCaptures(db: SQLiteDatabase): Promise<MusicCaptureRow[]> {
  return db.getAllAsync<MusicCaptureRow>(
    `SELECT * FROM music_captures WHERE status = 'new' ORDER BY created_at DESC`,
  );
}

export async function listRecentMusicCaptures(db: SQLiteDatabase, limit = 20): Promise<MusicCaptureRow[]> {
  return db.getAllAsync<MusicCaptureRow>(
    `SELECT * FROM music_captures WHERE status != 'dismissed' ORDER BY created_at DESC LIMIT ?`,
    limit,
  );
}

export async function markMusicCaptureNotified(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync(`UPDATE music_captures SET status = 'notified' WHERE id = ?`, id);
}

export async function markMusicCaptureDismissed(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync(`UPDATE music_captures SET status = 'dismissed' WHERE id = ?`, id);
}
