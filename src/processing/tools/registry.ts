/** Tool registry — the set of focused tools LUCY can pick from. Importing this pulls the tool impls
 *  (which depend on RN/expo), so pure code (selector parsing, tests) should NOT import this — use
 *  ./describe for the pure description helper. */
import type { LucyTool } from './types';
import { spendingTool } from './impl/spending';
import { memoryTool } from './impl/memory';
import { describeForSelector } from './describe';

// P0: spending + memory. P1 adds schedule/health/tasks/people/reminders/knowledge.
export const TOOLS: LucyTool[] = [spendingTool, memoryTool];

export function getTool(name: string): LucyTool | undefined {
  return TOOLS.find((t) => t.name === name);
}

export { describeForSelector };
