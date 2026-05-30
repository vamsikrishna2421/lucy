// Music detection removed — ShazamKit dependency dropped.
export interface MusicMatch {
  title: string;
  artist: string;
  album: string | null;
  confidence: number;
  spotifyTrackId: string | null;
  spotifyUrl: string | null;
  appleMusicUrl: string | null;
}
export function isShazamAvailable(): boolean { return false; }
export async function detectMusic(): Promise<MusicMatch | null> { return null; }
