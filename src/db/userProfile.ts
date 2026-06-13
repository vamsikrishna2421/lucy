import type { SQLiteDatabase } from 'expo-sqlite';
import { getDeviceSpeechLocale } from '../audio/transcriptionLanguage';
import { getSetting, setSetting } from './settings';
import { getInjectableLearnedFacts } from './learnedProfile';

export interface UserProfile {
  name: string;
  about: string;
  /** ISO-639-1 language codes the user speaks, e.g. ['te', 'en'] */
  languages: string[];
  /** Durable facts LUCY has learned about the user (Learned Profile). Auto-loaded;
   *  not user-edited. Injected into AI prompts via buildUserContextPrefix. */
  learnedFacts?: string[];
}

export async function getUserProfile(db: SQLiteDatabase): Promise<UserProfile> {
  const [name, about, langs, learnedFacts] = await Promise.all([
    getSetting(db, 'user_profile_name'),
    getSetting(db, 'user_profile_about'),
    getSetting(db, 'user_profile_languages'),
    getInjectableLearnedFacts(db).catch(() => [] as string[]),
  ]);
  return {
    name: name ?? '',
    about: about ?? '',
    languages: langs ? JSON.parse(langs) as string[] : [],
    learnedFacts,
  };
}

export async function saveUserProfile(db: SQLiteDatabase, profile: UserProfile): Promise<void> {
  await Promise.all([
    setSetting(db, 'user_profile_name', profile.name.trim()),
    setSetting(db, 'user_profile_about', profile.about.trim()),
    setSetting(db, 'user_profile_languages', JSON.stringify(profile.languages)),
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
  // Learned Profile — what LUCY has figured out about the user over time. Helps every
  // call tailor its behaviour (tone, priorities, preferences) to this specific person.
  const learned = (profile.learnedFacts ?? []).filter(Boolean);
  if (learned.length > 0) {
    parts.push(`What you've learned about ${name || 'them'} over time (use it to tailor your help; don't recite it back): ${learned.map((f) => `(${f})`).join(' ')}`);
  }
  return parts.length ? parts.join(' ') + '\n' : '';
}

export function getOnDeviceSpeechLocale(profile: UserProfile): string {
  return getDeviceSpeechLocale(profile.languages);
}
