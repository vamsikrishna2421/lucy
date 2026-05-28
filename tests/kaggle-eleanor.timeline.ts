import fs from 'node:fs';
import path from 'node:path';

type InjectionProbe = {
  date: string;
  injected_note: string;
  response_expected_content: string;
  testing_prompt: string;
};

type DailyCorpus = {
  DAILY_RECORDS: Record<string, string>;
};

type MemoryEntry = {
  id: string;
  date: number;
  text: string;
  kind: 'daily' | 'injection';
};

type TimelineProbeScore = {
  index: number;
  targetRetrieved: boolean;
  targetRank: number | null;
  passed?: boolean;
  coverage?: number;
  durationMs?: number;
  error?: string;
};

const rawDirectory = path.resolve(process.cwd(), 'benchmarks', 'kaggle-eleanor', 'raw');
const dailyPath = path.join(rawDirectory, 'Eleanor_Vance_Daily_Records_Dec-1-2020_to_Nov-30-2024.json');
const injectionPath = path.join(rawDirectory, 'Eleanor_Vance_manual_injections_info.json');
const outputDirectory = path.resolve(process.cwd(), 'benchmarks', 'kaggle-eleanor', 'results');
const model = process.env.ELEANOR_MODEL ?? 'phi3';
const runAnswers = process.env.ELEANOR_SKIP_MODEL !== 'true';
const limit = Number.parseInt(process.env.ELEANOR_LIMIT ?? '50', 10);
const retrievalLimit = Number.parseInt(process.env.ELEANOR_TOP_K ?? '5', 10);
const baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434';
const stopWords = new Set([
  'a', 'about', 'after', 'and', 'are', 'at', 'be', 'can', 'do', 'for', 'from',
  'get', 'has', 'have', 'i', 'in', 'is', 'it', 'me', 'my', 'of', 'on', 'or',
  'the', 'this', 'to', 'was', 'what', 'when', 'where', 'which', 'with',
]);

function toTimestamp(value: string): number {
  return new Date(value).getTime();
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((token) => token.length > 1 && !stopWords.has(token));
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function scoreAnswer(expected: string, answer: string): { passed: boolean; coverage: number } {
  const expectedValue = normalized(expected);
  const answerValue = normalized(answer);
  if (answerValue.includes(expectedValue)) {
    return { passed: true, coverage: 1 };
  }
  const expectedTokens = [...new Set(tokenize(expected))];
  const covered = expectedTokens.filter((token) => answerValue.includes(token)).length;
  const coverage = expectedTokens.length ? covered / expectedTokens.length : 0;
  return { passed: coverage >= 0.75, coverage };
}

function retrieve(question: string, entries: MemoryEntry[]): MemoryEntry[] {
  const queryTokens = [...new Set(tokenize(question))];
  const frequencies = new Map<string, number>();
  queryTokens.forEach((token) => {
    frequencies.set(token, entries.filter((entry) => tokenize(entry.text).includes(token)).length);
  });
  return entries
    .map((entry) => {
      const tokens = new Set(tokenize(entry.text));
      const score = queryTokens.reduce((sum, token) => {
        if (!tokens.has(token)) {
          return sum;
        }
        const documentFrequency = frequencies.get(token) ?? 1;
        return sum + Math.log((entries.length + 1) / (documentFrequency + 1)) + 1;
      }, 0);
      return { entry, score };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || right.entry.date - left.entry.date)
    .slice(0, retrievalLimit)
    .map((candidate) => candidate.entry);
}

async function answerLocally(question: string, retrieved: MemoryEntry[]): Promise<string> {
  const prompt = [
    'You are LUCY evaluating memory retrieval from fictional benchmark records.',
    'Answer the question using only the retrieved memories. Return only the short answer.',
    ...retrieved.map((entry, index) => `Memory ${index + 1}: ${entry.text}`),
    `Question: ${question}`,
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
      options: { temperature: 0, num_predict: 120 },
    }),
  });
  if (!response.ok) {
    throw new Error(`Ollama returned ${response.status}.`);
  }
  const body = await response.json() as { response?: string };
  return body.response ?? '';
}

async function main(): Promise<void> {
  const daily = JSON.parse(fs.readFileSync(dailyPath, 'utf8')) as DailyCorpus;
  const injectionMap = JSON.parse(fs.readFileSync(injectionPath, 'utf8')) as Record<string, InjectionProbe>;
  const probes = Object.values(injectionMap).slice(0, Number.isFinite(limit) ? limit : 50);
  const dailyEntries: MemoryEntry[] = Object.entries(daily.DAILY_RECORDS).map(([date, text], index) => ({
    id: `daily-${index + 1}`,
    date: toTimestamp(date),
    text,
    kind: 'daily',
  }));
  const injectedEntries: MemoryEntry[] = [];
  const scores: TimelineProbeScore[] = [];

  console.log(
    `Timeline benchmark: ${probes.length} probes, top ${retrievalLimit} recalled memories, ${runAnswers ? model : 'retrieval only'}.`,
  );
  for (let index = 0; index < probes.length; index += 1) {
    const probe = probes[index];
    const targetId = `injection-${index + 1}`;
    const target: MemoryEntry = {
      id: targetId,
      date: toTimestamp(probe.date),
      text: probe.injected_note,
      kind: 'injection',
    };
    injectedEntries.push(target);
    const available = [
      ...dailyEntries.filter((entry) => entry.date <= target.date),
      ...injectedEntries.filter((entry) => entry.date <= target.date),
    ];
    const recalled = retrieve(probe.testing_prompt, available);
    const rank = recalled.findIndex((entry) => entry.id === targetId);
    const score: TimelineProbeScore = {
      index: index + 1,
      targetRetrieved: rank >= 0,
      targetRank: rank >= 0 ? rank + 1 : null,
    };
    if (runAnswers) {
      const started = Date.now();
      try {
        const answer = await answerLocally(probe.testing_prompt, recalled);
        const answerScore = scoreAnswer(probe.response_expected_content, answer);
        score.passed = answerScore.passed;
        score.coverage = answerScore.coverage;
      } catch (error) {
        score.passed = false;
        score.coverage = 0;
        score.error = error instanceof Error ? error.message : 'Unknown model error.';
      }
      score.durationMs = Date.now() - started;
    }
    scores.push(score);
    if ((index + 1) % 10 === 0 || index + 1 === probes.length) {
      console.log(`  ${index + 1}/${probes.length}`);
    }
  }

  const retrievedCount = scores.filter((score) => score.targetRetrieved).length;
  const answerCount = scores.filter((score) => score.passed).length;
  const summary = {
    methodology: 'chronological-memory-retrieval',
    model: runAnswers ? model : null,
    topK: retrievalLimit,
    total: scores.length,
    targetRetrieved: retrievedCount,
    answeredCorrectly: runAnswers ? answerCount : null,
    averageCoverage: runAnswers
      ? scores.reduce((sum, score) => sum + (score.coverage ?? 0), 0) / scores.length
      : null,
    averageDurationMs: runAnswers
      ? scores.reduce((sum, score) => sum + (score.durationMs ?? 0), 0) / scores.length
      : null,
    scores,
  };
  fs.mkdirSync(outputDirectory, { recursive: true });
  const suffix = runAnswers ? model.replace(/[^a-z0-9.-]+/gi, '-') : 'retrieval-only';
  const reportPath = path.join(outputDirectory, `timeline-${suffix}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(reportPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`Timeline retrieval: ${retrievedCount}/${scores.length} injected memories returned in top ${retrievalLimit}.`);
  if (runAnswers) {
    console.log(
      `${model} answer score: ${answerCount}/${scores.length}, coverage ${((summary.averageCoverage ?? 0) * 100).toFixed(1)}%, average ${((summary.averageDurationMs ?? 0) / 1000).toFixed(2)}s/probe.`,
    );
  }
  console.log(`Sanitized scores written to ${path.relative(process.cwd(), reportPath)}.`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
