import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import { initializeSchema } from './init';

const DB_NAME = 'lucy.db';
const DATABASE_KEY_SETTING = 'lucy_database_key';
let databasePromise: Promise<SQLite.SQLiteDatabase> | undefined;

async function getDatabaseKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(DATABASE_KEY_SETTING);
  if (existing) return existing;
  const bytes = await Crypto.getRandomBytesAsync(32);
  const created = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  await SecureStore.setItemAsync(DATABASE_KEY_SETTING, created);
  return created;
}

async function openDatabase(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DB_NAME);
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
