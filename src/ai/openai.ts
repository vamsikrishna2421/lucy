import { config } from '../config';
import { getPreferredModel } from './modelPreference';
import type { ExtractionResult } from '../types/extraction';

/** Routes to Claude or OpenAI depending on the active model. Use this everywhere instead of promptOpenAI directly. */
export async function promptAI(system: string, input: string, apiKey: string): Promise<string> {
  const model = getPreferredModel(config.openAIModel);
  // Count this remote call toward the hourly cost guard.
  void import('./rateLimit').then((m) => m.recordAiCall()).catch(() => {});
  if (model.startsWith('claude-')) {
    const { promptClaude } = await import('./claude');
    return promptClaude(system, input, model);
  }
  return promptOpenAI(system, input, apiKey, model);
}
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
  const rawText = await response.text();

  // Guard: if server returned HTML instead of JSON (proxy error, rate limit page, etc.)
  if (rawText.trimStart().startsWith('<')) {
    throw new Error(`OpenAI returned an error page (status ${response.status}). Check your API key and internet connection.`);
  }

  if (!response.ok) {
    let detail = rawText.slice(0, 200);
    try { detail = (JSON.parse(rawText) as { error?: { message?: string } }).error?.message ?? detail; } catch { /* use raw */ }
    throw new Error(`OpenAI error ${response.status}: ${detail}`);
  }

  try {
    return textFromResponse(JSON.parse(rawText) as {
      output_text?: string;
      output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
    });
  } catch {
    throw new Error(`Could not parse OpenAI response. The API may be temporarily unavailable.`);
  }
}

export async function analyzeWithOpenAI(
  transcript: string,
  apiKey: string,
  userContextPrefix = '',
): Promise<ExtractionResult> {
  const raw = await promptAI(
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
