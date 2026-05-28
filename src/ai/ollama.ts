import { config } from '../config';
import type { ExtractionResult } from '../types/extraction';
import { extractionSchemaPrompt, extractionSystemPrompt, localReferenceTimestamp } from './prompts';

function parseJsonResponse(raw: string): ExtractionResult {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error('Local model did not return JSON.');
  }
  return JSON.parse(raw.slice(start, end + 1)) as ExtractionResult;
}

async function generateWithOllama(prompt: string, json = false): Promise<string> {
  const response = await fetch(`${config.ollamaBaseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.ollamaModel,
      stream: false,
      ...(json ? { format: 'json' } : {}),
      prompt,
      options: { temperature: 0, num_predict: 650 },
    }),
  });

  if (!response.ok) {
    throw new Error(`Local privacy model unavailable (${response.status}). Private input was not sent externally.`);
  }

  const result = (await response.json()) as { response?: string };
  return result.response ?? '';
}

export async function analyzeWithOllama(transcript: string): Promise<ExtractionResult> {
  const raw = await generateWithOllama(
    `${extractionSystemPrompt}\nReference local timestamp: ${localReferenceTimestamp()}\n${extractionSchemaPrompt}\nInput:\n${transcript}`,
    true,
  );
  return parseJsonResponse(raw);
}

export async function promptOllama(prompt: string): Promise<string> {
  return generateWithOllama(prompt, true);
}
