import fs from 'node:fs';
import path from 'node:path';

type InjectionProbe = {
  date: string;
  injected_note: string;
  response_expected_content: string;
  testing_prompt: string;
};

type ProbeResult = {
  index: number;
  protected: boolean;
  passed: boolean;
  coverage: number;
  durationMs: number;
  error?: string;
};

type ModelSummary = {
  model: string;
  passed: number;
  total: number;
  errors: number;
  protectedPassed: number;
  protectedTotal: number;
  averageCoverage: number;
  averageDurationMs: number;
  totalDurationMs: number;
  probes: ProbeResult[];
};

const inputPath = path.resolve(
  process.cwd(),
  'benchmarks',
  'kaggle-eleanor',
  'raw',
  'Eleanor_Vance_manual_injections_info.json',
);
const outputDirectory = path.resolve(process.cwd(), 'benchmarks', 'kaggle-eleanor', 'results');
const configuredModels = (process.env.ELEANOR_MODELS ?? 'qwen2.5:1.5b,phi3,qwen3.6')
  .split(',')
  .map((model: string) => model.trim())
  .filter(Boolean);
const limit = Number.parseInt(process.env.ELEANOR_LIMIT ?? '50', 10);
const baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434';
const stopWords = new Set([
  'a', 'an', 'and', 'are', 'at', 'be', 'for', 'from', 'has', 'in', 'is', 'it',
  'of', 'on', 'or', 'the', 'to', 'was', 'with',
]);

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function expectedTokens(value: string): string[] {
  return [...new Set(
    normalize(value)
      .split(' ')
      .filter((token) => token.length > 1 && !stopWords.has(token)),
  )];
}

function scoreAnswer(expected: string, answer: string): { passed: boolean; coverage: number } {
  const normalizedExpected = normalize(expected);
  const normalizedAnswer = normalize(answer);
  if (normalizedAnswer.includes(normalizedExpected)) {
    return { passed: true, coverage: 1 };
  }
  const tokens = expectedTokens(expected);
  if (tokens.length === 0) {
    return { passed: false, coverage: 0 };
  }
  const found = tokens.filter((token) => normalizedAnswer.includes(token)).length;
  const coverage = found / tokens.length;
  return { passed: coverage >= 0.75, coverage };
}

function containsProtectedShape(text: string): boolean {
  return /password|passcode|\bpin\b|allerg|cholesterol|health|mercury|pharmacy/i.test(text);
}

async function answerWithModel(model: string, probe: InjectionProbe): Promise<string> {
  const prompt = [
    'You are evaluating private on-device memory retrieval using fictional benchmark records.',
    'Answer the question using only the remembered note. Return only the short answer, without explanation.',
    `Remembered note: ${probe.injected_note}`,
    `Question: ${probe.testing_prompt}`,
    '/no_think',
  ].join('\n');
  const response = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      think: false,
      options: { temperature: 0, num_predict: 100 },
    }),
  });
  if (!response.ok) {
    throw new Error(`Ollama returned ${response.status}.`);
  }
  const body = await response.json() as { response?: string };
  return body.response ?? '';
}

async function runModel(model: string, probes: InjectionProbe[]): Promise<ModelSummary> {
  const results: ProbeResult[] = [];
  console.log(`Running ${model} on ${probes.length} Eleanor memory probes...`);
  for (let index = 0; index < probes.length; index += 1) {
    const probe = probes[index];
    const started = Date.now();
    try {
      const answer = await answerWithModel(model, probe);
      const score = scoreAnswer(probe.response_expected_content, answer);
      results.push({
        index: index + 1,
        protected: containsProtectedShape(
          `${probe.injected_note} ${probe.testing_prompt} ${probe.response_expected_content}`,
        ),
        passed: score.passed,
        coverage: score.coverage,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      results.push({
        index: index + 1,
        protected: containsProtectedShape(
          `${probe.injected_note} ${probe.testing_prompt} ${probe.response_expected_content}`,
        ),
        passed: false,
        coverage: 0,
        durationMs: Date.now() - started,
        error: error instanceof Error ? error.message : 'Unknown model error.',
      });
    }
    if ((index + 1) % 10 === 0 || index + 1 === probes.length) {
      console.log(`  ${model}: ${index + 1}/${probes.length}`);
    }
  }

  const protectedResults = results.filter((result) => result.protected);
  return {
    model,
    passed: results.filter((result) => result.passed).length,
    total: results.length,
    errors: results.filter((result) => Boolean(result.error)).length,
    protectedPassed: protectedResults.filter((result) => result.passed).length,
    protectedTotal: protectedResults.length,
    averageCoverage: results.reduce((sum, result) => sum + result.coverage, 0) / results.length,
    averageDurationMs: results.reduce((sum, result) => sum + result.durationMs, 0) / results.length,
    totalDurationMs: results.reduce((sum, result) => sum + result.durationMs, 0),
    probes: results,
  };
}

async function main(): Promise<void> {
  if (!fs.existsSync(inputPath)) {
    throw new Error('Eleanor raw benchmark files are missing. Run npm run test:kaggle-eleanor first.');
  }
  const records = JSON.parse(fs.readFileSync(inputPath, 'utf8')) as Record<string, InjectionProbe>;
  const probes = Object.values(records).slice(0, Number.isFinite(limit) ? limit : 50);
  const summaries: ModelSummary[] = [];
  for (const model of configuredModels) {
    summaries.push(await runModel(model, probes));
  }

  fs.mkdirSync(outputDirectory, { recursive: true });
  const reportPath = path.join(outputDirectory, `oracle-memory-models-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(reportPath, `${JSON.stringify({ methodology: 'oracle-memory-answering', models: summaries }, null, 2)}\n`);
  console.log('\nEleanor oracle-memory model comparison (answers remain local):');
  summaries.forEach((summary) => {
    const seconds = (summary.averageDurationMs / 1000).toFixed(2);
    const coverage = (summary.averageCoverage * 100).toFixed(1);
    console.log(
      `${summary.model}: ${summary.passed}/${summary.total} passed, protected ${summary.protectedPassed}/${summary.protectedTotal}, errors ${summary.errors}, coverage ${coverage}%, average ${seconds}s/probe`,
    );
  });
  console.log(`Sanitized per-probe scores written to ${path.relative(process.cwd(), reportPath)}.`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
