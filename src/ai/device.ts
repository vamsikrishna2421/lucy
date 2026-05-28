import {
  initExecutorch,
  isAvailable,
  LLMModule,
  models,
  type Message,
} from 'react-native-executorch';
import { ExpoResourceFetcher } from 'react-native-executorch-expo-resource-fetcher';
import { jsonrepair } from 'jsonrepair';
import { config } from '../config';
import { getDatabase } from '../db';
import { getSetting, setSetting } from '../db/settings';
import type { ExtractionResult } from '../types/extraction';
import { deviceExtractionPrompt, localReferenceTimestamp } from './prompts';
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

const obsoleteFastModel = models.llm.lfm2_5_350m({ quant: true });
const MODEL_SETTING = 'local_model_id';
const configuredDefault = config.deviceModelTier === 'balanced' ? 'balanced' : DEFAULT_LOCAL_MODEL_ID;
let selectedOption = resolveLocalModel(configuredDefault);
let selectedModel = withDevelopmentAssetRelay(selectedOption.createModel());

function withDevelopmentAssetRelay<T extends { modelSource: string; tokenizerSource: string; tokenizerConfigSource: string }>(configuredModel: T): T {
  return config.deviceModelAssetBaseUrl
  ? {
      ...configuredModel,
      modelSource: `${config.deviceModelAssetBaseUrl}/${configuredModel.modelSource.split('/').pop()}`,
      tokenizerSource: `${config.deviceModelAssetBaseUrl}/${configuredModel.tokenizerSource.split('/').pop()}`,
      tokenizerConfigSource: `${config.deviceModelAssetBaseUrl}/${configuredModel.tokenizerConfigSource.split('/').pop()}`,
    }
  : configuredModel;
}
const listeners = new Set<(state: DeviceModelState) => void>();
let model: LLMModule | undefined;
let loading: Promise<LLMModule> | undefined;
let initialized = false;
let state: DeviceModelState = {
  available: isAvailable,
  status: isAvailable ? 'not_loaded' : 'unavailable',
  progress: 0,
  modelName: selectedOption.name,
  modelId: selectedOption.id,
};

function updateState(update: Partial<DeviceModelState>): void {
  state = { ...state, ...update };
  listeners.forEach((listener) => listener(state));
}

function initializeRuntime(): void {
  if (initialized) {
    return;
  }
  initExecutorch({ resourceFetcher: ExpoResourceFetcher });
  initialized = true;
}

function parseJsonResponse(raw: string): ExtractionResult {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error('On-device model did not return JSON.');
  }
  return JSON.parse(jsonrepair(raw.slice(start, end + 1))) as ExtractionResult;
}

export function getDeviceModelState(): DeviceModelState {
  return state;
}

export function subscribeToDeviceModel(listener: (next: DeviceModelState) => void): () => void {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

export async function autoRestoreDeviceModel(): Promise<void> {
  if (!isAvailable || model || loading) {
    return;
  }
  if (await selectedModelIsDownloaded()) {
    void prepareDeviceModel();
  }
}

export async function initializeDeviceModelSelection(): Promise<DeviceModelState> {
  const db = await getDatabase();
  selectedOption = resolveLocalModel(await getSetting(db, MODEL_SETTING) ?? configuredDefault);
  selectedModel = withDevelopmentAssetRelay(selectedOption.createModel());
  updateState({ modelId: selectedOption.id, modelName: selectedOption.name });
  return state;
}

export async function selectDeviceModel(modelId: LocalModelId): Promise<DeviceModelState> {
  if (state.modelId === modelId) {
    return state;
  }
  if (model) {
    model.delete();
    model = undefined;
  }
  loading = undefined;
  const db = await getDatabase();
  await setSetting(db, MODEL_SETTING, modelId);
  selectedOption = resolveLocalModel(modelId);
  selectedModel = withDevelopmentAssetRelay(selectedOption.createModel());
  updateState({
    modelId: selectedOption.id,
    modelName: selectedOption.name,
    status: isAvailable ? 'not_loaded' : 'unavailable',
    progress: 0,
    error: undefined,
  });
  return state;
}

export async function prepareDeviceModel(): Promise<DeviceModelState> {
  if (!isAvailable) {
    updateState({ status: 'unavailable', error: 'On-device intelligence is unavailable on this device.' });
    return state;
  }
  if (model) {
    return state;
  }
  if (!loading) {
    initializeRuntime();
    updateState({ status: 'downloading', progress: 0, error: undefined });
    loading = LLMModule.fromModelName(
      selectedModel,
      (progress) => updateState({ progress }),
    )
      .then((loadedModel) => {
        loadedModel.configure({ generationConfig: { temperature: 0 } });
        model = loadedModel;
        updateState({ status: 'ready', progress: 1, error: undefined });
        return loadedModel;
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : 'On-device model setup failed.';
        updateState({ status: 'error', error: message });
        loading = undefined;
        throw error;
      });
  }
  await loading;
  return state;
}

async function selectedModelIsDownloaded(): Promise<boolean> {
  initializeRuntime();
  const files = await ExpoResourceFetcher.listDownloadedFiles();
  const filename = selectedModel.modelSource.split('/').pop();
  return Boolean(filename && files.some((file) => file.includes(filename)));
}

export async function clearDownloadedDeviceModels(): Promise<void> {
  if (model) {
    model.delete();
    model = undefined;
  }
  loading = undefined;
  initializeRuntime();
  await ExpoResourceFetcher.deleteResources(
    selectedModel.modelSource,
    selectedModel.tokenizerSource,
    selectedModel.tokenizerConfigSource,
  );
  updateState({ status: isAvailable ? 'not_loaded' : 'unavailable', progress: 0, error: undefined });
}

export async function clearAllDownloadedDeviceModels(): Promise<void> {
  if (model) {
    model.delete();
    model = undefined;
  }
  loading = undefined;
  initializeRuntime();
  const downloadable = localModelOptions.flatMap((option) => {
    const configured = withDevelopmentAssetRelay(option.createModel());
    return [configured.modelSource, configured.tokenizerSource, configured.tokenizerConfigSource];
  });
  await ExpoResourceFetcher.deleteResources(
    obsoleteFastModel.modelSource,
    obsoleteFastModel.tokenizerSource,
    obsoleteFastModel.tokenizerConfigSource,
    ...downloadable,
  );
  updateState({ status: isAvailable ? 'not_loaded' : 'unavailable', progress: 0, error: undefined });
}

async function generateOnDevice(messages: Message[]): Promise<string> {
  if (!model) {
    if (!await selectedModelIsDownloaded()) {
      throw new Error('Prepare on-device intelligence in Settings before organizing thoughts.');
    }
    await prepareDeviceModel();
  }
  if (!model) {
    throw new Error('On-device intelligence is not ready. Private input was not sent externally.');
  }
  let timedOut = false;
  const generationTimeoutMilliseconds = selectedOption.id === 'quick'
    ? 75_000
    : selectedOption.id === 'balanced'
      ? 180_000
      : 300_000;
  const timeout = setTimeout(() => {
    timedOut = true;
    model?.interrupt();
  }, generationTimeoutMilliseconds);
  try {
    const response = await model.generate(messages);
    if (timedOut) {
      throw new Error('On-device processing took too long; LUCY will retry automatically.');
    }
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

export async function analyzeWithDevice(transcript: string): Promise<ExtractionResult> {
  const raw = await generateOnDevice([
    {
      role: 'system',
      content: `${deviceExtractionPrompt}\nReference local timestamp: ${localReferenceTimestamp()}`,
    },
    { role: 'user', content: `${transcript}\n/no_think` },
  ]);
  return parseJsonResponse(raw);
}

export async function promptDevice(prompt: string): Promise<string> {
  return generateOnDevice([{ role: 'user', content: prompt }]);
}
