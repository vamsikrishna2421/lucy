/** Semantic tool router entry — selects tools, runs them, merges, returns a LucyAnswer.
 *  Dark-launched: askLucy only calls this when the `semantic_router_enabled` setting is 'on'. */
import type { SQLiteDatabase } from 'expo-sqlite';
import type { LucyAnswer } from '../ask';
import { selectTools } from './selector';
import { runSelected, mergeResults } from './merge';

export { TOOLS, describeForSelector } from './registry';
export { parseSelection, buildSelectorPrompt } from './selector';
export { assembleProse } from './merge';

export async function runSemanticRouter(
  db: SQLiteDatabase,
  question: string,
  history?: Array<{ role: 'user' | 'lucy'; content: string }>,
  screenContext?: string,
): Promise<LucyAnswer | null> {
  const ctx = { db, history, screenContext };
  const selection = await selectTools(ctx, question);
  const results = await runSelected(ctx, selection);
  if (!results.length) return null; // nothing ran — let the caller fall back to the legacy path
  const merged = await mergeResults(question, results);
  if (!merged.text.trim()) return null;
  return {
    supported: true,
    answerKind: 'llm',
    title: '',
    message: '',
    tasks: [],
    deadlines: [],
    recordedSignal: `Answered via tools: ${merged.toolNames.join(', ')}.`,
    llmResponse: merged.text,
    citedSources: merged.sources.map((s) => ({ captureId: s.captureId, title: s.title, snippet: s.snippet ?? '', capturedAt: '' })),
  };
}
