/** On-device model catalog — stubbed out while react-native-executorch is removed. */

export type LocalModelId = 'quick' | 'modern-light' | 'balanced' | 'deep' | 'deep-phi';

export interface LocalModelOption {
  id: LocalModelId;
  name: string;
  guidance: string;
  journalFit: string;
  createModel: () => unknown;
}

export const DEFAULT_LOCAL_MODEL_ID: LocalModelId = 'quick';

export const localModelOptions: LocalModelOption[] = [
  { id: 'quick',        name: 'Qwen3 0.6B',    guidance: 'Lightest option.',            journalFit: 'Basic extraction',   createModel: () => null },
  { id: 'modern-light', name: 'Qwen3.5 0.8B',  guidance: 'Newer lightweight option.',   journalFit: 'Light journal',      createModel: () => null },
  { id: 'balanced',     name: 'Qwen3.5 2B',    guidance: 'Medium local option.',         journalFit: 'Detailed journal',   createModel: () => null },
  { id: 'deep',         name: 'Qwen3 4B',      guidance: 'Large local option.',          journalFit: 'Deep journal',       createModel: () => null },
  { id: 'deep-phi',     name: 'Phi-4 Mini 4B', guidance: 'Alternative large model.',     journalFit: 'Deep comparison',    createModel: () => null },
];

export function resolveLocalModel(id: string | undefined): LocalModelOption {
  return localModelOptions.find((option) => option.id === id)
    ?? localModelOptions.find((option) => option.id === DEFAULT_LOCAL_MODEL_ID)!;
}
