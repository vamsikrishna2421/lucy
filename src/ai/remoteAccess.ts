import * as SecureStore from 'expo-secure-store';
import { config } from '../config';
import { getDatabase } from '../db';
import { getSetting, setSetting } from '../db/settings';

const REMOTE_ENABLED_SETTING = 'remote_openai_enabled';
const OPENAI_KEY_STORE = 'lucy_openai_api_key';

export interface RemoteAccessState {
  enabled: boolean;
  hasKey: boolean;
  usingDevelopmentKey: boolean;
  modelName: string;
}

async function storedKey(): Promise<string | null> {
  return SecureStore.getItemAsync(OPENAI_KEY_STORE);
}

function developmentKey(): string | null {
  return process.env.EXPO_PUBLIC_OPENAI_API_KEY?.trim() || null;
}

export async function getRemoteAccessState(): Promise<RemoteAccessState> {
  const db = await getDatabase();
  const [enabled, localKey] = await Promise.all([
    getSetting(db, REMOTE_ENABLED_SETTING),
    storedKey(),
  ]);
  const development = !localKey && Boolean(developmentKey());
  return {
    enabled: enabled === 'true',
    hasKey: Boolean(localKey || developmentKey()),
    usingDevelopmentKey: development,
    modelName: config.openAIModel,
  };
}

export async function getRemoteOpenAIKey(): Promise<string | null> {
  return (await storedKey()) ?? developmentKey();
}

export async function setRemoteEnabled(enabled: boolean): Promise<void> {
  const db = await getDatabase();
  await setSetting(db, REMOTE_ENABLED_SETTING, enabled ? 'true' : 'false');
}

export async function storeRemoteOpenAIKey(key: string): Promise<void> {
  const trimmed = key.trim();
  if (!trimmed) {
    throw new Error('Enter an OpenAI API key before saving.');
  }
  await SecureStore.setItemAsync(OPENAI_KEY_STORE, trimmed);
}

export async function removeRemoteOpenAIKey(): Promise<void> {
  await SecureStore.deleteItemAsync(OPENAI_KEY_STORE);
  await setRemoteEnabled(false);
}
