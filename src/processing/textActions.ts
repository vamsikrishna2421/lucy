import { promptAI } from '../ai/openai';
import { resolveRemoteAvailability } from '../ai/provider';
import { promptDevice } from '../ai/device';
import { getUserProfile, buildUserContextPrefix } from '../db/userProfile';
import { getDatabase } from '../db';

export type TextActionType = 'summarize' | 'improve' | 'translate' | 'explain' | 'action_items' | 'structure';

export interface TextActionResult {
  action: TextActionType;
  original: string;
  result: string;
}

const SYSTEM_PROMPTS: Record<TextActionType, string> = {
  summarize: 'Summarize the following text in 2-3 clear sentences. Plain text only, no markdown.',
  improve: 'Rewrite the following text to be clearer, more concise, and better structured. Keep the meaning. Plain text only.',
  translate: 'Translate the following text to English if it is in another language. If already in English, improve its clarity. Plain text only.',
  explain: 'Explain the following text simply, as if to someone unfamiliar with the topic. Keep it brief. Plain text only.',
  action_items: 'Extract all action items, tasks, and next steps from the following text. Format as a plain numbered list. Plain text only.',
  structure: 'Reorganize the following messy or unstructured notes into a clear, structured format with sections and bullet points. Plain text only.',
};

export async function runTextAction(
  action: TextActionType,
  text: string,
): Promise<TextActionResult> {
  const db = await getDatabase();
  const [profile, remote] = await Promise.all([getUserProfile(db), resolveRemoteAvailability()]);
  const userPrefix = buildUserContextPrefix(profile);
  const systemPrompt = `${userPrefix}${SYSTEM_PROMPTS[action]}`;

  let result: string;
  try {
    if (remote.available) {
      result = await promptAI(systemPrompt, text, remote.openAIKey);
    } else {
      result = await promptDevice(`${systemPrompt}\n\nText:\n${text}\n/no_think`);
    }
  } catch {
    result = 'Could not process this text. Enable Remote Intelligence in Settings for best results.';
  }

  return { action, original: text, result: result.trim() };
}

export const TEXT_ACTION_LABELS: Record<TextActionType, string> = {
  summarize: 'Summarize',
  improve: 'Improve writing',
  translate: 'Translate to English',
  explain: 'Explain this',
  action_items: 'Extract action items',
  structure: 'Structure notes',
};
