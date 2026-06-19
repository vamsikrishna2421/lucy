/** Tool registry — the set of focused tools LUCY can pick from. Importing this pulls the tool impls
 *  (which depend on RN/expo), so pure code (selector parsing, tests) should NOT import this — use
 *  ./describe for the pure description helper. */
import type { LucyTool } from './types';
import { spendingTool } from './impl/spending';
import { moneyWatchTool } from './impl/moneyWatch';
import { memoryTool } from './impl/memory';
import { tasksTool } from './impl/tasks';
import { healthTool } from './impl/health';
import { remindersTool } from './impl/reminders';
import { peopleTool } from './impl/people';
import { keepWarmTool } from './impl/keepWarm';
import { commitmentsTool } from './impl/commitments';
import { knowledgeTool } from './impl/knowledge';
import { describeForSelector } from './describe';

// P1: read tools wrapping existing engines. memory stays the catch-all (last). Action intents
// (commit a calendar block, create a reminder, log food) remain on the legacy path for now — P2.
export const TOOLS: LucyTool[] = [spendingTool, moneyWatchTool, tasksTool, healthTool, remindersTool, peopleTool, keepWarmTool, commitmentsTool, knowledgeTool, memoryTool];

export function getTool(name: string): LucyTool | undefined {
  return TOOLS.find((t) => t.name === name);
}

export { describeForSelector };
