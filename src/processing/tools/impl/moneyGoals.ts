/** Money goals tool — savings goals and whether you're on pace. Use for "how's my savings goal",
 *  "am I on track to save for the move", "how much have I saved". Distinct from spending (history)
 *  and money_watch (bills/subscriptions/anomalies). */
import type { LucyTool } from '../types';

export const moneyGoalsTool: LucyTool = {
  name: 'money_goals',
  description: "Savings goals + pacing — use for 'how's my savings goal', 'am I on track to save for X', 'how much have I saved toward the move', 'my money goals'. For past spending use spending; for bills/subscriptions/unusual charges use money_watch.",
  async run(ctx) {
    const { getGoalsWithProgress } = await import('../../../db/moneyGoals');
    const { goalGuidance } = await import('../../moneyGoals');
    const goals = await getGoalsWithProgress(ctx.db);
    if (goals.length === 0) {
      return { kind: 'money_goals', data: { goals: [] }, prose: "You don't have any savings goals yet. Add one under Expenses → Goals — e.g. save 2000 for the move by August — and I'll track your pace toward it." };
    }
    const prose = goals.map((g) => goalGuidance(g.label, g.progress, g.currency)).join(' ');
    return { kind: 'money_goals', data: { goals }, prose };
  },
};
