// Decoupled from react-native-executorch's STATIC import: importing executorch at app
// startup crashes hard if the native module isn't loadable (e.g. org.pytorch.executorch.Module
// missing on an arch/build). Model configs are built lazily — only when the user actually
// prepares an on-device model — so this module is always safe to import.

export type LocalModelId = 'quick' | 'modern-light' | 'balanced' | 'deep' | 'deep-phi';

/** Minimal shape device.ts needs from a model config (executorch returns a superset). */
export interface LocalModelConfig {
  modelSource: string;
  tokenizerSource: string;
  tokenizerConfigSource: string;
  [key: string]: unknown;
}

export interface LocalModelOption {
  id: LocalModelId;
  name: string;
  guidance: string;
  journalFit: string;
  createModel: () => LocalModelConfig;
}

/** Lazy, guarded access to executorch's model builders (only hit when creating a model). */
function llm(): Record<string, (opts: { quant: boolean }) => LocalModelConfig> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('react-native-executorch').models.llm;
}

export const DEFAULT_LOCAL_MODEL_ID: LocalModelId = 'quick';

export const localModelOptions: LocalModelOption[] = [
  {
    id: 'quick',
    name: 'Qwen3 0.6B',
    guidance: 'Lightest option. Best for older phones or fast trials.',
    journalFit: 'Basic extraction',
    createModel: () => llm().qwen3_0_6b({ quant: true }),
  },
  {
    id: 'modern-light',
    name: 'Qwen3.5 0.8B',
    guidance: 'Newer lightweight Qwen option for comparing quality without heavy hardware needs.',
    journalFit: 'Light journal',
    createModel: () => llm().qwen3_5_0_8b({ quant: true }),
  },
  {
    id: 'balanced',
    name: 'Qwen3.5 2B',
    guidance: 'Newer medium local option and recommended starting point for journal-quality testing.',
    journalFit: 'Detailed journal',
    createModel: () => llm().qwen3_5_2b({ quant: true }),
  },
  {
    id: 'deep',
    name: 'Qwen3 4B',
    guidance: 'Large local option for recent high-memory phones. Expect slower processing.',
    journalFit: 'Deep journal',
    createModel: () => llm().qwen3_4b({ quant: true }),
  },
  {
    id: 'deep-phi',
    name: 'Phi-4 Mini 4B',
    guidance: 'Alternative large local model for outcome comparison on powerful phones.',
    journalFit: 'Deep comparison',
    createModel: () => llm().phi_4_mini_4b({ quant: true }),
  },
];

export function resolveLocalModel(id: string | undefined): LocalModelOption {
  return localModelOptions.find((option) => option.id === id)
    ?? localModelOptions.find((option) => option.id === DEFAULT_LOCAL_MODEL_ID)!;
}
