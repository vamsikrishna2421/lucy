import type { SQLiteDatabase } from 'expo-sqlite';
import { getSetting, setSetting } from './settings';

export interface UserProfile {
  name: string;
  about: string;
}

export async function getUserProfile(db: SQLiteDatabase): Promise<UserProfile> {
  const [name, about] = await Promise.all([
    getSetting(db, 'user_profile_name'),
    getSetting(db, 'user_profile_about'),
  ]);
  return { name: name ?? '', about: about ?? '' };
}

export async function saveUserProfile(db: SQLiteDatabase, profile: UserProfile): Promise<void> {
  await Promise.all([
    setSetting(db, 'user_profile_name', profile.name.trim()),
    setSetting(db, 'user_profile_about', profile.about.trim()),
  ]);
}

// Returns a short context string prepended to AI system prompts.
// Empty string when no profile has been set.
export function buildUserContextPrefix(profile: UserProfile): string {
  const name = profile.name.trim();
  const about = profile.about.trim();
  if (!name && !about) return '';
  const parts: string[] = [];
  if (name) parts.push(`The person you are helping is named ${name}. Always refer to them as ${name}, never as "User" or "the user".`);
  if (about) parts.push(`About ${name || 'them'}: ${about}`);
  return parts.join(' ') + '\n';
}
