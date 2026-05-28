import { config } from '../config';
import type { ExtractionResult } from '../types/extraction';
import { extractionSchemaPrompt, extractionSystemPrompt, localReferenceTimestamp } from './prompts';

function getApiKey(): string {
  const apiKey = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('Set EXPO_PUBLIC_ANTHROPIC_API_KEY to process normal captures with Claude.');
  }
  return apiKey;
}

export async function analyzeWithClaude(transcript: string): Promise<ExtractionResult> {
  const raw = await promptClaude(
    `${extractionSystemPrompt}\nReference local timestamp: ${localReferenceTimestamp()}\n${extractionSchemaPrompt}`,
    transcript,
    config.claudeExtractionModel,
  );
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error('Claude did not return structured JSON.');
  }
  return JSON.parse(raw.slice(start, end + 1)) as ExtractionResult;
}

export async function promptClaude(system: string, input: string, model = config.claudeExtractionModel): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': getApiKey(),
    },
    body: JSON.stringify({
      model,
      max_tokens: 1800,
      system,
      messages: [{ role: 'user', content: input }],
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Claude request failed (${response.status}): ${detail}`);
  }
  const message = (await response.json()) as {
    content: Array<{ type: string; text?: string }>;
  };
  return message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n');
}
