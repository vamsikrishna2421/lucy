import type { ExtractionResult } from '../types/extraction';
import { analyzeTranscript } from './extract';

export interface BenchmarkResult {
  id: string;
  label: string;
  passed: boolean;
  durationMs: number;
  detail: string;
}

interface BenchmarkCase {
  id: string;
  label: string;
  input: string;
  evaluate: (result: ExtractionResult) => string | null;
}

const cases: BenchmarkCase[] = [
  {
    id: 'expense',
    label: 'Expense',
    input: 'Paid 23 dollars for groceries today.',
    evaluate: (result) => (
      result.privacy_level === 'normal'
      && result.expenses.some((expense) => expense.amount.includes('23'))
        ? null
        : 'Expected a normal $23 expense.'
    ),
  },
  {
    id: 'task',
    label: 'Task',
    input: 'Please call Maya tomorrow about renewing the apartment lease.',
    evaluate: (result) => (
      result.tasks.some((task) => /call|maya|lease/i.test(task.task))
        ? null
        : 'Expected a call task.'
    ),
  },
  {
    id: 'reminder',
    label: 'Reminder',
    input: 'Remind me on May 27 2026 at 9:00 AM to submit the rent receipt.',
    evaluate: (result) => (
      result.reminders.some((reminder) => Boolean(reminder.time))
        ? null
        : 'Expected a timed reminder.'
    ),
  },
  {
    id: 'private-idea',
    label: 'Private idea',
    input: 'Startup idea: create a private app called Grove that organizes seed photos.',
    evaluate: (result) => (
      result.privacy_level === 'private' && result.ideas.length > 0
        ? null
        : 'Expected a private idea.'
    ),
  },
  {
    id: 'place',
    label: 'Place',
    input: 'I want to visit the Brooklyn Botanic Garden this Saturday.',
    evaluate: (result) => (
      result.places.some((place) => /brooklyn|botanic|garden/i.test(place.name))
        ? null
        : 'Expected a saved place.'
    ),
  },
  {
    id: 'decision',
    label: 'Decision',
    input: 'I decided to cancel my gym membership next month.',
    evaluate: (result) => (
      result.decisions.some((decision) => /cancel|gym/i.test(decision))
        ? null
        : 'Expected a recorded decision.'
    ),
  },
  {
    id: 'credentials',
    label: 'Credential privacy',
    input: 'My password is ExampleOnly-4829; I need to change it tonight.',
    evaluate: (result) => {
      const repeatsSecret = JSON.stringify(result).toLowerCase().includes('exampleonly-4829');
      return result.privacy_level === 'private' && !repeatsSecret
        ? null
        : 'Expected private output without repeating the credential.';
    },
  },
];

export async function runEnglishDeviceBenchmark(
  onProgress?: (complete: number, total: number) => void,
): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];
  for (const test of cases) {
    const started = Date.now();
    try {
      const extraction = await analyzeTranscript(test.input, { localOnly: true });
      const failure = test.evaluate(extraction);
      results.push({
        id: test.id,
        label: test.label,
        passed: failure === null,
        durationMs: Date.now() - started,
        detail: failure ?? extraction.title,
      });
    } catch (error) {
      results.push({
        id: test.id,
        label: test.label,
        passed: false,
        durationMs: Date.now() - started,
        detail: error instanceof Error ? error.message : 'Analysis failed.',
      });
    }
    onProgress?.(results.length, cases.length);
  }
  return results;
}
