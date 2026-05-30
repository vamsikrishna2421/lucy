import { config } from '../config';
import { jsonrepair } from 'jsonrepair';
import type { ExtractionResult, PrivacyLevel } from '../types/extraction';
import { analyzeWithDevice, promptDevice } from './device';
import { analyzeWithOllama, promptOllama } from './ollama';
import { analyzeWithOpenAI, promptOpenAI } from './openai';
import { dailySummaryPrompt, privateRemoteRedactionPrompt, urgentScanPrompt } from './prompts';
import { getRemoteAccessState, getRemoteOpenAIKey, getClaudeApiKey } from './remoteAccess';
import { redactForRemote } from '../processing/redaction';
import { getPreferredModel } from './modelPreference';
import { getDatabase } from '../db';
import { getUserProfile, buildUserContextPrefix } from '../db/userProfile';

/** Resolves whether remote analysis is available for the *currently selected* model,
 *  checking the correct provider's key (Anthropic for claude-*, OpenAI otherwise).
 *  Fixes the bug where a Claude-only setup never went remote because availability
 *  was gated solely on the OpenAI key + OpenAI "remote enabled" toggle. */
async function resolveRemoteForAnalyze(): Promise<{ available: boolean; openAIKey: string }> {
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

function parseSanitizedText(raw: string): string {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error('Protected remote masking did not return JSON.');
  }
  const parsed = JSON.parse(jsonrepair(raw.slice(start, end + 1))) as { sanitized_text?: string; redacted?: boolean };
  const sanitized = parsed.sanitized_text?.trim() ?? '';
  if (!parsed.redacted || !sanitized || !/\[(?:PRIVATE|PERSON|HEALTH|CREDENTIAL|ACCOUNT|CARD)_\d+\]/i.test(sanitized)) {
    throw new Error('Protected content was not safely masked for remote processing.');
  }
  return redactForRemote(sanitized).text;
}

async function sanitizePrivatelyForRemote(transcript: string): Promise<string> {
  const raw = await localPrompt(`${privateRemoteRedactionPrompt}\nInput:\n${transcript}\n/no_think`);
  return parseSanitizedText(raw);
}

export const AIProvider = {
  async analyzeLocally(transcript: string): Promise<ExtractionResult> {
    return localAnalyze(transcript);
  },
  async analyze(transcript: string, _privacyLevel: PrivacyLevel): Promise<ExtractionResult> {
    // User directive: process EVERYTHING remotely regardless of privacy level — the
    // on-device model is intentionally disconnected. On-device privacy redaction
    // (sanitizePrivatelyForRemote) is deliberately NOT used here; privacy masking will
    // be revisited later. Sending the raw transcript to the configured remote provider.
    const { available, openAIKey } = await resolveRemoteForAnalyze();
    if (!available) {
      return localAnalyze(transcript);
    }
    const db = await getDatabase();
    const profile = await getUserProfile(db);
    const userContextPrefix = buildUserContextPrefix(profile);
    // analyzeWithOpenAI → promptAI routes to Claude or OpenAI based on the selected model.
    // If this throws, processQueue sees the real error and marks the capture as failed.
    return await analyzeWithOpenAI(transcript, openAIKey, userContextPrefix);
  },
  async urgentScan(transcript: string, privacyLevel: PrivacyLevel = 'local'): Promise<string> {
    const prompt = `${urgentScanPrompt}\nTranscript:\n${transcript}`;
    const remote = await getRemoteAccessState();
    const apiKey = remote.enabled && remote.hasKey ? await getRemoteOpenAIKey() : null;
    if (privacyLevel !== 'normal' || !remote.enabled || !apiKey || config.aiMode === 'offline') {
      return localPrompt(prompt);
    }
    return promptOpenAI(urgentScanPrompt, transcript, apiKey);
  },
  async summarize(notes: string, privacyLevel: PrivacyLevel = 'normal'): Promise<string> {
    const remote = await getRemoteAccessState();
    const apiKey = remote.enabled && remote.hasKey ? await getRemoteOpenAIKey() : null;
    if (privacyLevel !== 'normal' || !remote.enabled || !apiKey || config.aiMode === 'offline') {
      return localPrompt(`${dailySummaryPrompt}\nNotes:\n${notes}`);
    }
    return promptOpenAI(dailySummaryPrompt, notes, apiKey, config.openAISummaryModel);
  },
};
