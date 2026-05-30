import { config } from '../config';
import { getPreferredModel } from './modelPreference';
import type { ExtractionResult } from '../types/extraction';
import { extractionSchemaPrompt, extractionSystemPrompt, localReferenceTimestamp } from './prompts';

function textFromResponse(result: {
  output_text?: string;
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
}): string {
  return result.output_text
    ?? result.output?.flatMap((item) => item.content ?? [])
      .filter((content) => content.type === 'output_text')
      .map((content) => content.text ?? '')
      .join('\n')
    ?? '';
}

export async function promptOpenAI(
  system: string,
  input: string,
  apiKey: string,
  model = getPreferredModel(config.openAIModel),
): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      reasoning: { effort: 'none' },
      max_output_tokens: 1800,
      instructions: system,
      input,
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI request failed (${response.status}): ${detail}`);
  }
  return textFromResponse(await response.json() as {
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  });
}

export async function analyzeWithOpenAI(
  transcript: string,
  apiKey: string,
  userContextPrefix = '',
): Promise<ExtractionResult> {
  const raw = await promptOpenAI(
    `${userContextPrefix}${extractionSystemPrompt}\nReference local timestamp: ${localReferenceTimestamp()}\n${extractionSchemaPrompt}`,
    transcript,
    apiKey,
  );
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error('GPT-5.4 Nano did not return structured JSON.');
  }
  return JSON.parse(raw.slice(start, end + 1)) as ExtractionResult;
}
