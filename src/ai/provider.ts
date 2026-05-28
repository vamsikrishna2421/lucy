import { config } from '../config';
import { jsonrepair } from 'jsonrepair';
import type { ExtractionResult, PrivacyLevel } from '../types/extraction';
import { analyzeWithDevice, promptDevice } from './device';
import { analyzeWithOllama, promptOllama } from './ollama';
import { analyzeWithOpenAI, promptOpenAI } from './openai';
import { dailySummaryPrompt, privateRemoteRedactionPrompt, urgentScanPrompt } from './prompts';
import { getRemoteAccessState, getRemoteOpenAIKey } from './remoteAccess';
import { redactForRemote } from '../processing/redaction';

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
  async analyze(transcript: string, privacyLevel: PrivacyLevel): Promise<ExtractionResult> {
    const remote = await getRemoteAccessState();
    const apiKey = remote.enabled && remote.hasKey ? await getRemoteOpenAIKey() : null;
    const remoteUnavailable = !remote.enabled
      || !apiKey
      || config.aiMode === 'offline';
    if (remoteUnavailable) {
      return localAnalyze(transcript);
    }
    try {
      const remoteTranscript = privacyLevel === 'private'
        ? await sanitizePrivatelyForRemote(transcript)
        : transcript;
      return await analyzeWithOpenAI(remoteTranscript, apiKey);
    } catch {
      return localAnalyze(transcript);
    }
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
