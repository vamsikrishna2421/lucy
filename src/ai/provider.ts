import { config } from '../config';
import type { ExtractionResult, PrivacyLevel } from '../types/extraction';
import { analyzeWithDevice, promptDevice } from './device';
import { analyzeWithOllama, promptOllama } from './ollama';
import { analyzeWithOpenAI, promptAI } from './openai';
import { dailySummaryPrompt, urgentScanPrompt } from './prompts';
import { getRemoteAccessState, getRemoteOpenAIKey, getClaudeApiKey } from './remoteAccess';
import { shieldText, restoreText, rehydrateExtraction, PLACEHOLDER_NOTE } from '../processing/sensitiveShield';
import { getPreferredModel, modelForTask, type AiTask } from './modelPreference';
import { getDatabase } from '../db';
import { getUserProfile, buildUserContextPrefix } from '../db/userProfile';
import type { SQLiteDatabase } from 'expo-sqlite';

/** Loads saved contact names so the on-device shield can recognise them. Never throws. */
async function loadContactNames(db: SQLiteDatabase): Promise<string[]> {
  try {
    const rows = await db.getAllAsync<{ name: string }>('SELECT name FROM people');
    return rows.map((r) => r.name).filter(Boolean);
  } catch {
    return [];
  }
}

/** Resolves whether remote analysis is available for the *currently selected* model,
 *  checking the correct provider's key (Anthropic for claude-*, OpenAI otherwise).
 *  Fixes the bug where a Claude-only setup never went remote because availability
 *  was gated solely on the OpenAI key + OpenAI "remote enabled" toggle. */
export async function resolveRemoteAvailability(): Promise<{ available: boolean; openAIKey: string }> {
  if (config.aiMode === 'offline') {
    return { available: false, openAIKey: '' };
  }
  const model = getPreferredModel(config.openAIModel);
  if (model.startsWith('claude-')) {
    const claudeKey = (await getClaudeApiKey()) ?? process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY?.trim() ?? null;
    // promptClaude fetches its own key internally, so openAIKey is unused for Claude.
    return { available: Boolean(claudeKey), openAIKey: '' };
  }
  const remote = await getRemoteAccessState();
  const openAIKey = remote.enabled && remote.hasKey ? await getRemoteOpenAIKey() : null;
  return { available: Boolean(openAIKey), openAIKey: openAIKey ?? '' };
}

/** Status of the user's SELECTED model + whether its provider key is present. Used by interactive
 *  flows (Ask/voice/image/food) to show an actionable "add your key" popup instead of silently
 *  falling back to a different model or on-device. */
export interface ModelKeyStatus { model: string; remote: boolean; keyPresent: boolean; provider: string }

export async function getModelKeyStatus(): Promise<ModelKeyStatus> {
  const model = getPreferredModel(config.openAIModel);
  if (model.startsWith('claude-')) {
    const claudeKey = (await getClaudeApiKey()) ?? process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY?.trim() ?? null;
    return { model, remote: true, keyPresent: Boolean(claudeKey), provider: 'Anthropic (Claude)' };
  }
  // Anything that isn't an OpenAI model is treated as on-device (no key needed).
  if (!/^(gpt|o[0-9]|chatgpt|text-)/i.test(model)) {
    return { model, remote: false, keyPresent: true, provider: 'on-device' };
  }
  const remote = await getRemoteAccessState();
  const openAIKey = remote.enabled && remote.hasKey ? await getRemoteOpenAIKey() : null;
  return { model, remote: true, keyPresent: Boolean(openAIKey), provider: 'OpenAI' };
}

/** Actionable, non-scary message when the selected model's key is missing. */
export function modelKeyMissingMessage(s: ModelKeyStatus): string {
  return `I can't reach ${s.model} — add your ${s.provider} API key in Settings → Remote intelligence to use it.`;
}

function localAnalyze(transcript: string): Promise<ExtractionResult> {
  return config.localInference === 'ollama-dev'
    ? analyzeWithOllama(transcript)
    : analyzeWithDevice(transcript);
}

function localPrompt(prompt: string): Promise<string> {
  return config.localInference === 'ollama-dev'
    ? promptOllama(prompt)
    : promptDevice(prompt);
}

export const AIProvider = {
  async analyzeLocally(transcript: string): Promise<ExtractionResult> {
    return localAnalyze(transcript);
  },
  async analyze(transcript: string, _privacyLevel: PrivacyLevel): Promise<ExtractionResult> {
    const { available, openAIKey } = await resolveRemoteAvailability();
    if (!available) {
      return localAnalyze(transcript);
    }
    const db = await getDatabase();
    const profile = await getUserProfile(db);
    // Privacy Shield: replace passwords + people names with placeholder tokens on-device
    // before the remote call, then restore the real values in the result. The fast
    // deterministic detector always runs; if the user opted into on-device AI detection,
    // the local LLM also contributes names (self-gated in detectNamesOnDevice — returns []
    // instantly when off or no model).
    const contacts = await loadContactNames(db);
    const { detectNamesOnDevice } = await import('../processing/deviceNer');
    const llmNames = await detectNamesOnDevice(transcript);
    const { redacted, map } = shieldText(transcript, [...contacts, ...llmNames]);
    const userContextPrefix = buildUserContextPrefix(profile) + (map.length ? PLACEHOLDER_NOTE : '');
    const model = modelForTask('extraction', config.openAIModel);
    const t0 = Date.now();
    let result: ExtractionResult;
    try {
      result = await analyzeWithOpenAI(redacted, openAIKey, userContextPrefix);
      result = rehydrateExtraction(result, map);
      void import('../db/devLog').then(({ insertDevLog }) => insertDevLog(db, {
        category: 'extraction', model,
        input_preview: redacted.slice(0, 300),
        output_preview: result.title ?? result.summary ?? '',
        duration_ms: Date.now() - t0, error: null,
      })).catch(() => {});
    } catch (e) {
      void import('../db/devLog').then(({ insertDevLog }) => insertDevLog(db, {
        category: 'extraction', model,
        input_preview: redacted.slice(0, 300),
        output_preview: '',
        duration_ms: Date.now() - t0,
        error: e instanceof Error ? e.message : String(e),
      })).catch(() => {});
      throw e;
    }
    return result;
  },
  async urgentScan(transcript: string, _privacyLevel: PrivacyLevel = 'local'): Promise<string> {
    // Provider-aware + everything-remote (privacy deferred): promptAI routes to Claude
    // when a claude-* model is selected, so Claude-only users still get urgent scans.
    const { available, openAIKey } = await resolveRemoteAvailability();
    if (!available) {
      return localPrompt(`${urgentScanPrompt}\nTranscript:\n${transcript}`);
    }
    const { redacted, map } = await shieldInput(transcript);
    const out = await promptAI(urgentScanPrompt + (map.length ? PLACEHOLDER_NOTE : ''), redacted, openAIKey, 'summary');
    return restoreText(out, map);
  },
  async summarize(notes: string, _privacyLevel: PrivacyLevel = 'normal'): Promise<string> {
    const { available, openAIKey } = await resolveRemoteAvailability();
    if (!available) {
      return localPrompt(`${dailySummaryPrompt}\nNotes:\n${notes}`);
    }
    const { redacted, map } = await shieldInput(notes);
    const out = await promptAI(dailySummaryPrompt + (map.length ? PLACEHOLDER_NOTE : ''), redacted, openAIKey, 'summary');
    return restoreText(out, map);
  },
  /** Generic provider-aware prompt (Claude or OpenAI based on selected model).
   *  `task` selects the cost tier — pass 'insight' for synthesis, 'segment'/'summary' for routine work,
   *  and leave the default 'chat' for interactive Ask/voice (honors the user's exact model pick). */
  async prompt(system: string, input: string, task: AiTask = 'chat'): Promise<string> {
    const { available, openAIKey } = await resolveRemoteAvailability();
    if (!available) {
      return localPrompt(`${system}\n${input}`);
    }
    const { redacted, map } = await shieldInput(input);
    const out = await promptAI(system + (map.length ? PLACEHOLDER_NOTE : ''), redacted, openAIKey, task);
    return restoreText(out, map);
  },
};

/** Shields a free-text input for remote prompts (insight/Ask/summary/urgent scan). */
async function shieldInput(input: string): Promise<{ redacted: string; map: ReturnType<typeof shieldText>['map'] }> {
  try {
    const db = await getDatabase();
    const contacts = await loadContactNames(db);
    const { detectNamesOnDevice } = await import('../processing/deviceNer');
    const llmNames = await detectNamesOnDevice(input);
    return shieldText(input, [...contacts, ...llmNames]);
  } catch {
    return { redacted: input, map: [] };
  }
}
