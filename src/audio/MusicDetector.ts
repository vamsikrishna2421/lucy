// Music detection via ShazamKit (iOS built-in, free).
// ShazamKit is a native iOS framework — this module loads it dynamically
// so the app does not crash before the native module is compiled into the build.
// To activate: add the ShazamKit config plugin in the next EAS build (1.0.5).

export interface MusicMatch {
  title: string;
  artist: string;
  album: string | null;
  confidence: number;
  spotifyTrackId: string | null;
  spotifyUrl: string | null;
  appleMusicUrl: string | null;
}

// Loaded at runtime once the native build includes react-native-shazamkit.
let ShazamKit: ShazamKitModule | null = null;
try {
  ShazamKit = (require('react-native-shazamkit') as { default: ShazamKitModule }).default;
} catch {
  // Not available in this build yet — will be added in 1.0.5.
}

export function isShazamAvailable(): boolean {
  return ShazamKit !== null;
}

export async function detectMusic(): Promise<MusicMatch | null> {
  if (!ShazamKit) return null;
  try {
    const result = await ShazamKit.recognize();
    if (!result) return null;

    const spotifyUrl = result.appleMusicID
      ? `spotify:search:${encodeURIComponent(`${result.artist ?? ''} ${result.title ?? ''}`)}`
      : null;
    const appleMusicUrl = result.appleMusicID
      ? `https://music.apple.com/us/song/${result.appleMusicID}`
      : `https://music.apple.com/search?term=${encodeURIComponent(`${result.artist ?? ''} ${result.title ?? ''}`)}`;

    return {
      title: result.title ?? 'Unknown title',
      artist: result.artist ?? 'Unknown artist',
      album: result.album ?? null,
      confidence: 1,
      spotifyTrackId: null,
      spotifyUrl,
      appleMusicUrl,
    };
  } catch {
    return null;
  }
}

interface ShazamKitModule {
  recognize(): Promise<{
    title?: string;
    artist?: string;
    album?: string;
    appleMusicID?: string;
  } | null>;
}
