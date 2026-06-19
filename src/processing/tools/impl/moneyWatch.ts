/** Money-watch tool — foresight over what the user already logs: recurring charges/subscriptions,
 *  upcoming bills, unusual charges, and going over the usual. Distinct from `spending` (plain totals). */
import type { LucyTool } from '../types';

function cadence(c: 'weekly' | 'monthly' | 'quarterly'): string {
  return c === 'monthly' ? '/mo' : c === 'weekly' ? '/wk' : '/qtr';
}

export const moneyWatchTool: LucyTool = {
  name: 'money_watch',
  description: "Recurring charges & subscriptions, upcoming bills due, unusual/large charges, and spending that's over the usual — use for 'what subscriptions do I have', 'any bills coming up', 'what's renewing', 'am I overspending', 'any unusual charges'. NOT for plain totals/breakdowns (that's the spending tool).",
  async run(ctx) {
    const { getMoneyInsights, detectRecurring } = await import('../../moneyWatch');
    const { listExpenses } = await import('../../../db/expenses');
    const expenses = await listExpenses(ctx.db);
    const recurring = detectRecurring(expenses);
    const insights = await getMoneyInsights(ctx.db); // bills due → anomalies → drift, already human + prioritized
    const recurringLine = recurring.length
      ? `You have ${recurring.length} recurring charge${recurring.length === 1 ? '' : 's'}: ${recurring.slice(0, 6).map((r) => `${r.label} ~$${Math.round(r.amount)}${cadence(r.cadence)}`).join(', ')}.`
      : '';
    const prose = [insights.join(' '), recurringLine].filter(Boolean).join(' ')
      || 'No subscriptions, upcoming bills, or unusual spending stand out right now.';
    return { kind: 'money_watch', data: { insights, recurring }, prose };
  },
};
