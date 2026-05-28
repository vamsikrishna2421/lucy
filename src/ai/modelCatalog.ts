import { models } from 'react-native-executorch';

export type LocalModelId = 'quick' | 'modern-light' | 'balanced' | 'deep' | 'deep-phi';

export interface LocalModelOption {
  id: LocalModelId;
  name: string;
  guidance: string;
  journalFit: string;
  createModel: () => ReturnType<typeof models.llm.qwen3_0_6b>
    | ReturnType<typeof models.llm.qwen3_5_0_8b>
    | ReturnType<typeof models.llm.qwen3_5_2b>
    | ReturnType<typeof models.llm.qwen3_1_7b>
    | ReturnType<typeof models.llm.qwen3_4b>
    | ReturnType<typeof models.llm.phi_4_mini_4b>;
}

export const DEFAULT_LOCAL_MODEL_ID: LocalModelId = 'quick';

export const localModelOptions: LocalModelOption[] = [
  {
    id: 'quick',
    name: 'Qwen3 0.6B',
    guidance: 'Lightest option. Best for older phones or fast trials.',
    journalFit: 'Basic extraction',
    createModel: () => models.llm.qwen3_0_6b({ quant: true }),
  },
  {
    id: 'modern-light',
    name: 'Qwen3.5 0.8B',
    guidance: 'Newer lightweight Qwen option for comparing quality without heavy hardware needs.',
    journalFit: 'Light journal',
    createModel: () => models.llm.qwen3_5_0_8b({ quant: true }),
  },
  {
    id: 'balanced',
    name: 'Qwen3.5 2B',
    guidance: 'Newer medium local option and recommended starting point for journal-quality testing.',
    journalFit: 'Detailed journal',
    createModel: () => models.llm.qwen3_5_2b({ quant: true }),
  },
  {
    id: 'deep',
    name: 'Qwen3 4B',
    guidance: 'Large local option for recent high-memory phones. Expect slower processing.',
    journalFit: 'Deep journal',
    createModel: () => models.llm.qwen3_4b({ quant: true }),
  },
  {
    id: 'deep-phi',
    name: 'Phi-4 Mini 4B',
    guidance: 'Alternative large local model for outcome comparison on powerful phones.',
    journalFit: 'Deep comparison',
    createModel: () => models.llm.phi_4_mini_4b({ quant: true }),
  },
];

export function resolveLocalModel(id: string | undefined): LocalModelOption {
  return localModelOptions.find((option) => option.id === id)
    ?? localModelOptions.find((option) => option.id === DEFAULT_LOCAL_MODEL_ID)!;
}
