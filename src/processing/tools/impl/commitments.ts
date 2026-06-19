/** Commitments tool — promises the user made and things they're owed, with deadlines. Use for
 *  "what did I promise", "what do I owe", "who owes me", "what am I waiting on", "anything due". */
import type { LucyTool } from '../types';

export const commitmentsTool: LucyTool = {
  name: 'commitments',
  description: "Promises and obligations with deadlines — use for 'what did I promise', 'what do I owe', 'who owes me', 'what am I waiting on', 'am I on the hook for anything', 'anything due'. For undated to-dos use the tasks tool; for one-off alarms use reminders.",
  async run(ctx) {
    const { buildCommitmentSummary } = await import('../../commitmentGuardian');
    const { prose, data } = await buildCommitmentSummary(ctx.db);
    return { kind: 'commitments', data, prose };
  },
};
