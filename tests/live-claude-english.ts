import { analyzeWithClaude } from '../src/ai/claude';
import { evaluateComparableExtraction, remoteComparableCases } from './outcome-catalog';

async function run(): Promise<void> {
  const requestedLimit = Number(process.env.LUCY_AB_LIMIT ?? remoteComparableCases.length);
  const cases = remoteComparableCases.slice(0, Number.isFinite(requestedLimit) ? requestedLimit : remoteComparableCases.length);
  console.log('Claude outcome comparison: ideas, privacy, and LUCY multi-memory cases are intentionally excluded from network calls.');
  let passed = 0;
  let durationTotal = 0;
  for (const test of cases) {
    const started = Date.now();
    const result = await analyzeWithClaude(test.input);
    const durationMs = Date.now() - started;
    const failure = evaluateComparableExtraction(test, result);
    const success = failure === null;
    durationTotal += durationMs;
    if (success) {
      passed += 1;
    }
    console.log(`${test.id}: ${success ? 'Pass' : 'Fail'} / ${(durationMs / 1000).toFixed(1)}s / ${failure ?? result.title}`);
  }

  console.log(`Claude safe-comparison result: ${passed}/${cases.length} passed / average ${(durationTotal / cases.length / 1000).toFixed(1)}s.`);
  if (passed !== cases.length) {
    process.exitCode = 1;
  }
}

void run();
