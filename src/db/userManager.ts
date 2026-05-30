/**
 * Multi-brain user manager.
 * Each user gets their own encrypted SQLite DB: lucy_<userId>.db
 * Switching users = closing current DB + opening the user's DB.
 */

import * as SecureStore from 'expo-secure-store';

const ACTIVE_USER_KEY = 'lucy_active_user';

export interface BrainUser {
  id: string;       // slug used in DB filename
  name: string;     // display name
  isDemo?: boolean;
}

// In-memory state — set once on app start, reset on switch
let _activeUser: BrainUser = { id: 'main', name: 'My Brain' };

export const DEMO_USER: BrainUser = { id: 'demo', name: 'Demo Brain', isDemo: true };

export function getActiveUser(): BrainUser {
  return _activeUser;
}

export function getDbName(): string {
  // 'main' uses the original lucy.db for backward compatibility with existing installs
  if (_activeUser.id === 'main') return 'lucy.db';
  return `lucy_${_activeUser.id}.db`;
}

export function getDbKeyName(): string {
  // 'main' uses the original key name for backward compatibility
  if (_activeUser.id === 'main') return 'lucy_database_key';
  return `lucy_database_key_${_activeUser.id}`;
}

/** Called once on app boot to restore the last active user */
export async function loadActiveUser(): Promise<BrainUser> {
  try {
    const stored = await SecureStore.getItemAsync(ACTIVE_USER_KEY);
    if (stored) {
      _activeUser = JSON.parse(stored) as BrainUser;
    }
  } catch { /* use default */ }
  return _activeUser;
}

/** Returns all users who have a stored DB key (i.e., have been created) */
export async function listUsers(): Promise<BrainUser[]> {
  try {
    const listJson = await SecureStore.getItemAsync('lucy_user_list');
    if (listJson) return JSON.parse(listJson) as BrainUser[];
  } catch { /* fall through */ }
  return [{ id: 'main', name: 'My Brain' }];
}

export async function addUser(user: BrainUser): Promise<void> {
  const existing = await listUsers();
  const updated = [...existing.filter((u) => u.id !== user.id), user];
  await SecureStore.setItemAsync('lucy_user_list', JSON.stringify(updated));
}

/** Switch the active brain. Caller must reset databasePromise after this. */
export async function switchUser(user: BrainUser): Promise<void> {
  _activeUser = user;
  await SecureStore.setItemAsync(ACTIVE_USER_KEY, JSON.stringify(user));
  await addUser(user);
}
