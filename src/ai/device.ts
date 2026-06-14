// NO import (not even `import type`) from 'react-native-executorch': type-only imports can
// survive bundling and leave a bare top-level require() that runs at app startup and crashes
// when the native module isn't loadable (org.pytorch.executorch.Module). Local types below;
// every runtime value goes through the guarded lazy require() accessors (et()/resourceFetcher()).
type Message = { role: 'system' | 'user' | 'assistant'; content: string };
type LLMModule = {
  configure: (opts: unknown) => void;
  generate: (messages: Message[]) => Promise<string>;
  interrupt: () => void;
  delete: () => void;
  [key: string]: unknown;
};
import { jsonrepair } from 'jsonrepair';
import { config } from '../config';
import { getDatabase } from '../db';
import { getSetting, setSetting } from '../db/settings';
import type { ExtractionResult } from '../types/extraction';
import { deviceExtractionPrompt, localReferenceTimestamp } from './prompts';
import { DEFAULT_LOCAL_MODEL_ID, localModelOptions, resolveLocalModel, type LocalModelId, type LocalModelConfig } from './modelCatalog';

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-var-requires */
// Guarded lazy access to react-native-executorch. Returns null if the native module is
// missing/unloadable (older arch, failed build) so the feature degrades instead of crashing.
let _et: any; // undefined = not tried, null = unavailable
function et(): any {
  if (_et !== undefined) return _et;
  try { _et = require('react-native-executorch'); } catch { _et = null; }
  return _et;
}
let _fetcher: any;
function resourceFetcher(): any {
  if (_fetcher !== undefined) return _fetcher;
  try { _fetcher = require('react-native-executorch-expo-resource-fetcher').ExpoResourceFetcher; } catch { _fetcher = null; }
  return _fetcher;
}
/** Whether on-device LLM is usable on this device/build (never throws). */
function deviceLLMAvailable(): boolean {
  try { const m = et(); return !!m && !!m.isAvailable; } catch { return false; }
}

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
const configuredDefault = config.deviceModelTier === 'balanced' ? 'balanced' : DEFAULT_LOCAL_MODEL_ID;
let selectedOption = resolveLocalModel(configuredDefault);
// Built lazily (createModel touches executorch) and reset when the selection changes.
let _selectedModel: LocalModelConfig | undefined;
function selectedModel(): LocalModelConfig {
  if (!_selectedModel) _selectedModel = withDevelopmentAssetRelay(selectedOption.createModel());
  return _selectedModel;
}
function obsoleteFastModel(): LocalModelConfig | null {
  const m = et(); return m ? (m.models.llm.lfm2_5_350m({ quant: true }) as LocalModelConfig) : null;
}

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
  available: deviceLLMAvailable(),
  status: deviceLLMAvailable() ? 'not_loaded' : 'unavailable',
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
  const m = et();
  if (m) m.initExecutorch({ resourceFetcher: resourceFetcher() });
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
  if (!deviceLLMAvailable() || model || loading) {
    return;
  }
  if (await selectedModelIsDownloaded()) {
    void prepareDeviceModel();
  }
}

export async function initializeDeviceModelSelection(): Promise<DeviceModelState> {
  const db = await getDatabase();
  selectedOption = resolveLocalModel(await getSetting(db, MODEL_SETTING) ?? configuredDefault);
  _selectedModel = undefined; // rebuild lazily for the new selection
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
  _selectedModel = undefined; // rebuild lazily for the new selection
  updateState({
    modelId: selectedOption.id,
    modelName: selectedOption.name,
    status: deviceLLMAvailable() ? 'not_loaded' : 'unavailable',
    progress: 0,
    error: undefined,
  });
  return state;
}

export async function prepareDeviceModel(): Promise<DeviceModelState> {
  if (!deviceLLMAvailable()) {
    updateState({ status: 'unavailable', error: 'On-device intelligence is unavailable on this device.' });
    return state;
  }
  if (model) {
    return state;
  }
  if (!loading) {
    initializeRuntime();
    updateState({ status: 'downloading', progress: 0, error: undefined });
    loading = et().LLMModule.fromModelName(
      selectedModel(),
      (progress: number) => updateState({ progress }),
    )
      .then((loadedModel: LLMModule) => {
        loadedModel.configure({ generationConfig: { temperature: 0 } });
        model = loadedModel;
        updateState({ status: 'ready', progress: 1, error: undefined });
        return loadedModel;
      })
      .catch((error: unknown) => {
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
  const fetcher = resourceFetcher();
  if (!fetcher) return false;
  const files = await fetcher.listDownloadedFiles();
  const filename = selectedModel().modelSource.split('/').pop();
  return Boolean(filename && files.some((file: string) => file.includes(filename)));
}

export async function clearDownloadedDeviceModels(): Promise<void> {
  if (model) {
    model.delete();
    model = undefined;
  }
  loading = undefined;
  initializeRuntime();
  const fetcher = resourceFetcher();
  const sel = selectedModel();
  if (fetcher) await fetcher.deleteResources(sel.modelSource, sel.tokenizerSource, sel.tokenizerConfigSource);
  updateState({ status: deviceLLMAvailable() ? 'not_loaded' : 'unavailable', progress: 0, error: undefined });
}

export async function clearAllDownloadedDeviceModels(): Promise<void> {
  if (model) {
    model.delete();
    model = undefined;
  }
  loading = undefined;
  initializeRuntime();
  const fetcher = resourceFetcher();
  if (fetcher) {
    const downloadable = localModelOptions.flatMap((option) => {
      const configured = withDevelopmentAssetRelay(option.createModel());
      return [configured.modelSource, configured.tokenizerSource, configured.tokenizerConfigSource];
    });
    const obsolete = obsoleteFastModel();
    const obsoleteSrcs = obsolete ? [obsolete.modelSource, obsolete.tokenizerSource, obsolete.tokenizerConfigSource] : [];
    await fetcher.deleteResources(...obsoleteSrcs, ...downloadable);
  }
  updateState({ status: deviceLLMAvailable() ? 'not_loaded' : 'unavailable', progress: 0, error: undefined });
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
