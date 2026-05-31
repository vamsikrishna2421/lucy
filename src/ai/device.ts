/**
 * On-device LLM — stubbed out while react-native-executorch is removed.
 * All methods throw so callers fall through to remote AI.
 */
import { getDatabase } from '../db';
import { getSetting, setSetting } from '../db/settings';
import type { ExtractionResult } from '../types/extraction';
import { DEFAULT_LOCAL_MODEL_ID, localModelOptions, resolveLocalModel, type LocalModelId } from './modelCatalog';

export type DeviceModelStatus = 'not_loaded' | 'downloading' | 'ready' | 'error' | 'unavailable';

export interface DeviceModelState {
  available: boolean;
  status: DeviceModelStatus;
  progress: number;
  modelName: string;
  modelId: LocalModelId;
  error?: string;
}

const MODEL_SETTING = 'local_model_id';
const listeners = new Set<(state: DeviceModelState) => void>();

let selectedOption = resolveLocalModel(DEFAULT_LOCAL_MODEL_ID);
let state: DeviceModelState = {
  available: false,
  status: 'unavailable',
  progress: 0,
  modelName: selectedOption.name,
  modelId: selectedOption.id,
};

function updateState(update: Partial<DeviceModelState>): void {
  state = { ...state, ...update };
  listeners.forEach((l) => l(state));
}

export function getDeviceModelState(): DeviceModelState { return state; }

export function subscribeToDeviceModel(listener: (next: DeviceModelState) => void): () => void {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

export async function autoRestoreDeviceModel(): Promise<void> { /* no-op */ }

export async function initializeDeviceModelSelection(): Promise<DeviceModelState> {
  const db = await getDatabase();
  selectedOption = resolveLocalModel(await getSetting(db, MODEL_SETTING) ?? DEFAULT_LOCAL_MODEL_ID);
  updateState({ modelId: selectedOption.id, modelName: selectedOption.name });
  return state;
}

export async function selectDeviceModel(modelId: LocalModelId): Promise<DeviceModelState> {
  const db = await getDatabase();
  await setSetting(db, MODEL_SETTING, modelId);
  selectedOption = resolveLocalModel(modelId);
  updateState({ modelId: selectedOption.id, modelName: selectedOption.name });
  return state;
}

export async function prepareDeviceModel(): Promise<DeviceModelState> {
  updateState({ status: 'unavailable', error: 'On-device LLM is currently disconnected. Use remote intelligence.' });
  return state;
}

export async function clearDownloadedDeviceModels(): Promise<void> { /* no-op */ }
export async function clearAllDownloadedDeviceModels(): Promise<void> { /* no-op */ }

export async function analyzeWithDevice(_transcript: string): Promise<ExtractionResult> {
  throw new Error('On-device LLM is disconnected — using remote AI instead.');
}

export async function promptDevice(_prompt: string): Promise<string> {
  throw new Error('On-device LLM is disconnected — using remote AI instead.');
}
