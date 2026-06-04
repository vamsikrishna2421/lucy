import type { SQLiteDatabase } from 'expo-sqlite';
import { getSetting, setSetting } from './settings';

export interface UserProfile {
  name: string;
  about: string;
  /** ISO-639-1 language codes the user speaks, e.g. ['te', 'en'] */
  languages: string[];
  /** Transcription engine: 'whisper' (OpenAI, cloud) | 'device' (iOS SFSpeechRecognizer, offline) */
  transcriptionEngine: 'whisper' | 'device';
}

export async function getUserProfile(db: SQLiteDatabase): Promise<UserProfile> {
  const [name, about, langs, engine] = await Promise.all([
    getSetting(db, 'user_profile_name'),
    getSetting(db, 'user_profile_about'),
    getSetting(db, 'user_profile_languages'),
    getSetting(db, 'user_transcription_engine'),
  ]);
  return {
    name: name ?? '',
    about: about ?? '',
    languages: langs ? JSON.parse(langs) as string[] : [],
    transcriptionEngine: (engine as 'whisper' | 'device') ?? 'whisper',
  };
}

export async function saveUserProfile(db: SQLiteDatabase, profile: UserProfile): Promise<void> {
  await Promise.all([
    setSetting(db, 'user_profile_name', profile.name.trim()),
    setSetting(db, 'user_profile_about', profile.about.trim()),
    setSetting(db, 'user_profile_languages', JSON.stringify(profile.languages)),
    setSetting(db, 'user_transcription_engine', profile.transcriptionEngine),
  ]);
}

export function buildUserContextPrefix(profile: UserProfile): string {
  const name = profile.name.trim();
  const about = profile.about.trim();
  const parts: string[] = [];
  if (name) parts.push(`The person you are helping is named ${name}. Always refer to them as ${name}, never as "User" or "the user".`);
  if (about) parts.push(`About ${name || 'them'}: ${about}`);
  if (profile.languages.length > 0) {
    const langNames: Record<string, string> = { en: 'English', te: 'Telugu', hi: 'Hindi', ta: 'Tamil', kn: 'Kannada', ml: 'Malayalam', mr: 'Marathi', bn: 'Bengali', gu: 'Gujarati', pa: 'Punjabi', ur: 'Urdu' };
    const names = profile.languages.map((l) => langNames[l] ?? l).join(' and ');
    parts.push(`They speak ${names}. Captures may contain ${names} words mixed together.`);
  }
  return parts.length ? parts.join(' ') + '\n' : '';
}

// Whisper language hint: returns the ISO-639-1 code for the primary non-English language,
// or null if English-only (no language hint needed — Whisper detects it fine).
export function getWhisperLanguageHint(profile: UserProfile): string | null {
  const primaryNonEnglish = profile.languages.find((l) => l !== 'en');
  return primaryNonEnglish ?? null;
}
