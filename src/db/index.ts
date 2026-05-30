import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import { initializeSchema } from './init';
import { getDbName, getDbKeyName } from './userManager';

let databasePromise: Promise<SQLite.SQLiteDatabase> | undefined;

async function getDatabaseKey(): Promise<string> {
  const keyName = getDbKeyName();
  const existing = await SecureStore.getItemAsync(keyName);
  if (existing) return existing;
  const bytes = await Crypto.getRandomBytesAsync(32);
  const created = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  await SecureStore.setItemAsync(keyName, created);
  return created;
}

async function openDatabase(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(getDbName());
  const key = await getDatabaseKey();
  await db.execAsync(`PRAGMA key = "x'${key}'";`);
  const cipher = await db.getFirstAsync<{ cipher_version: string }>('PRAGMA cipher_version;');
  if (!cipher?.cipher_version) {
    await db.closeAsync();
    throw new Error('Encrypted storage is unavailable. Use an Expo development build with SQLCipher enabled.');
  }
  await initializeSchema(db);
  return db;
}

export function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  databasePromise ??= openDatabase();
  return databasePromise;
}

/** Close current DB and reset promise — call after switching users */
export async function resetDatabase(): Promise<void> {
  if (databasePromise) {
    try {
      const db = await databasePromise;
      await db.closeAsync();
    } catch { /* ignore close errors */ }
  }
  databasePromise = undefined;
}

/**
 * Open a named DB independently of the active user — used for background seeding
 * so Eleanor's brain can be populated without switching the active user's DB.
 */
export async function openNamedDatabase(name: string, keyStoreName: string): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(name);
  let key = await SecureStore.getItemAsync(keyStoreName);
  if (!key) {
    const bytes = await Crypto.getRandomBytesAsync(32);
    key = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    await SecureStore.setItemAsync(keyStoreName, key);
  }
  await db.execAsync(`PRAGMA key = "x'${key}'";`);
  const cipher = await db.getFirstAsync<{ cipher_version: string }>('PRAGMA cipher_version;');
  if (!cipher?.cipher_version) { await db.closeAsync(); return db; }
  await initializeSchema(db);
  return db;
}
