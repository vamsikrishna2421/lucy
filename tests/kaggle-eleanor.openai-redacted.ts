import fs from 'node:fs';
import path from 'node:path';
import { applyRemoteRedactionMap, redactForRemote } from '../src/processing/redaction';

type InjectionProbe = {
  date: string;
  injected_note: string;
  response_expected_content: string;
  testing_prompt: string;
};

type PreparedProbe = {
  outbound: string;
  expected: string;
  localModelRedactions: number;
  fallbackRedactions: number;
};

const inputPath = path.resolve(
  process.cwd(),
  'benchmarks',
  'kaggle-eleanor',
  'raw',
  'Eleanor_Vance_manual_injections_info.json',
);
const outputDirectory = path.resolve(process.cwd(), 'benchmarks', 'kaggle-eleanor', 'results');
const limit = Number.parseInt(process.env.ELEANOR_LIMIT ?? '50', 10);
const includeHealth = process.env.ELEANOR_REMOTE_INCLUDE_HEALTH === 'true';
const localPrivacyModel = process.env.ELEANOR_PRIVACY_MODEL ?? 'phi3';
const openAIModels = (process.env.ELEANOR_OPENAI_MODELS
  ?? 'gpt-5.4-nano,gpt-5.4-mini,gpt-5.4,gpt-5.5')
  .split(',')
  .map((model: string) => model.trim())
  .filter(Boolean);
const ollamaBaseUrl = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434';
const healthSignal = /health|pain|anxiety|panic|allerg|medicat|doctor|physio|cholesterol|mercury|pharmacy/i;
const possibleSecretSignal = /password|passcode|\bpin\b|otp|account number|card number|cvv|routing number/i;
const stopWords = new Set([
  'a', 'an', 'and', 'are', 'at', 'be', 'for', 'from', 'has', 'in', 'is', 'it',
  'of', 'on', 'or', 'the', 'to', 'was', 'with',
]);

function getApiKey(): string {
  const value = process.env.OPENAI_API_KEY ?? process.env.EXPO_PUBLIC_OPENAI_API_KEY;
  if (!value) {
    throw new Error('Set OPENAI_API_KEY in .env.local before running the OpenAI benchmark.');
  }
  return value;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9[\]_]+/g, ' ').trim();
}

function scoreAnswer(expected: string, answer: string): { passed: boolean; coverage: number } {
  const normalizedExpected = normalize(expected);
  const normalizedAnswer = normalize(answer);
  if (normalizedAnswer.includes(normalizedExpected)) {
    return { passed: true, coverage: 1 };
  }
  const tokens = [...new Set(
    normalizedExpected.split(' ').filter((token) => token.length > 1 && !stopWords.has(token)),
  )];
  const coverage = tokens.length
    ? tokens.filter((token) => normalizedAnswer.includes(token)).length / tokens.length
    : 0;
  return { passed: coverage >= 0.75, coverage };
}

async function detectSecretsLocally(text: string): Promise<string[]> {
  if (!possibleSecretSignal.test(text)) {
    return [];
  }
  const response = await fetch(`${ollamaBaseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: localPrivacyModel,
      stream: false,
      format: 'json',
      prompt: [
        'Find secret values in this synthetic benchmark text before a remote API request.',
        'Return JSON only: {"secret_values":["exact value"]}.',
        'Include password, passcode, PIN, OTP, card, or account values. Do not include ordinary names or recommendations.',
        `Text: ${text}`,
      ].join('\n'),
      options: { temperature: 0, num_predict: 120 },
    }),
  });
  if (!response.ok) {
    throw new Error(`Local privacy model failed (${response.status}). Remote request was not sent.`);
  }
  const body = await response.json() as { response?: string };
  try {
    const parsed = JSON.parse(body.response ?? '{}') as { secret_values?: unknown };
    return Array.isArray(parsed.secret_values)
      ? parsed.secret_values.filter((value): value is string => typeof value === 'string' && value.trim().length >= 3)
      : [];
  } catch {
    throw new Error('Local privacy model did not return readable redaction JSON. Remote request was not sent.');
  }
}

function redactLocallyDetectedValues(
  text: string,
  expected: string,
  values: string[],
): { text: string; expected: string; count: number } {
  let outbound = text;
  let redactedExpected = expected;
  let count = 0;
  [...new Set(values)].forEach((value) => {
    if (!outbound.includes(value)) {
      return;
    }
    count += 1;
    const placeholder = `[LOCAL_SECRET_${count}]`;
    outbound = outbound.replaceAll(value, placeholder);
    redactedExpected = redactedExpected.replaceAll(value, placeholder);
  });
  return { text: outbound, expected: redactedExpected, count };
}

async function prepareProbe(probe: InjectionProbe): Promise<PreparedProbe> {
  const rawOutbound = `Remembered note: ${probe.injected_note}\nQuestion: ${probe.testing_prompt}`;
  const detectedValues = await detectSecretsLocally(rawOutbound);
  const modelRedacted = redactLocallyDetectedValues(
    rawOutbound,
    probe.response_expected_content,
    detectedValues,
  );
  const fallback = redactForRemote(modelRedacted.text);
  return {
    outbound: fallback.text,
    expected: applyRemoteRedactionMap(modelRedacted.expected, fallback.replacements),
    localModelRedactions: modelRedacted.count,
    fallbackRedactions: fallback.replacements.length,
  };
}

async function promptOpenAI(model: string, input: string): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      reasoning: { effort: 'none' },
      max_output_tokens: 120,
      instructions: 'You are evaluating memory retrieval using synthetic benchmark records. Answer using only the remembered note. Return only the short answer, without explanation. Preserve placeholders such as [LOCAL_SECRET_1] and [CREDENTIAL_1] verbatim.',
      input,
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI request failed (${response.status}): ${detail}`);
  }
  const result = await response.json() as {
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  };
  return result.output_text
    ?? result.output?.flatMap((item) => item.content ?? [])
      .filter((content) => content.type === 'output_text')
      .map((content) => content.text ?? '')
      .join('\n')
    ?? '';
}

async function main(): Promise<void> {
  getApiKey();
  if (!fs.existsSync(inputPath)) {
    throw new Error('Eleanor raw benchmark files are missing. Run npm run test:kaggle-eleanor first.');
  }
  const records = JSON.parse(fs.readFileSync(inputPath, 'utf8')) as Record<string, InjectionProbe>;
  const allProbes = Object.values(records);
  const eligible = allProbes.filter((probe) => (
    includeHealth || !healthSignal.test(`${probe.injected_note} ${probe.testing_prompt} ${probe.response_expected_content}`)
  ));
  const probes = eligible.slice(0, Number.isFinite(limit) ? limit : eligible.length);
  const prepared: PreparedProbe[] = [];

  console.log(
    `OpenAI redacted-memory benchmark: ${probes.length}/${allProbes.length} probes eligible; health-shaped probes ${includeHealth ? 'included by explicit override' : 'excluded'}. Local privacy model: ${localPrivacyModel}.`,
  );
  for (const probe of probes) {
    prepared.push(await prepareProbe(probe));
  }
  const summaries = [];
  for (const openAIModel of openAIModels) {
    const results: Array<{ index: number; passed: boolean; coverage: number; durationMs: number; localModelRedactions: number; fallbackRedactions: number }> = [];
    console.log(`Running ${openAIModel} on ${probes.length} prepared probes...`);
    for (let index = 0; index < probes.length; index += 1) {
      const outbound = prepared[index];
      const started = Date.now();
      const answer = await promptOpenAI(openAIModel, outbound.outbound);
      const score = scoreAnswer(outbound.expected, answer);
      results.push({
        index: index + 1,
        passed: score.passed,
        coverage: score.coverage,
        durationMs: Date.now() - started,
        localModelRedactions: outbound.localModelRedactions,
        fallbackRedactions: outbound.fallbackRedactions,
      });
      if ((index + 1) % 10 === 0 || index + 1 === probes.length) {
        console.log(`  ${openAIModel}: ${index + 1}/${probes.length}`);
      }
    }
    summaries.push({
      model: openAIModel,
      passed: results.filter((result) => result.passed).length,
      total: results.length,
      locallyRedactedProbes: results.filter((result) => result.localModelRedactions > 0).length,
      fallbackRedactedProbes: results.filter((result) => result.fallbackRedactions > 0).length,
      averageCoverage: results.reduce((sum, result) => sum + result.coverage, 0) / results.length,
      averageDurationMs: results.reduce((sum, result) => sum + result.durationMs, 0) / results.length,
      probes: results,
    });
  }
  const report = {
    methodology: 'oracle-memory-answering-after-local-phi3-redaction',
    localPrivacyModel,
    healthIncluded: includeHealth,
    eligible: eligible.length,
    totalAvailable: allProbes.length,
    models: summaries,
  };
  fs.mkdirSync(outputDirectory, { recursive: true });
  const reportPath = path.join(outputDirectory, `oracle-memory-openai-redacted-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  summaries.forEach((summary) => {
    console.log(
      `${summary.model}: ${summary.passed}/${summary.total} passed, phi3-redacted ${summary.locallyRedactedProbes}, fallback-redacted ${summary.fallbackRedactedProbes}, coverage ${(summary.averageCoverage * 100).toFixed(1)}%, average ${(summary.averageDurationMs / 1000).toFixed(2)}s/probe.`,
    );
  });
  console.log(`Sanitized scores written to ${path.relative(process.cwd(), reportPath)}.`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
