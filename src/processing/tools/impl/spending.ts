/** Spending tool — money the user actually SPENT/PAID, by time window + category. Wraps the existing
 *  spendingWindow + expense helpers (no new logic). Never counts savings/income. */
import type { LucyTool } from '../types';
import { listExpenses } from '../../../db/expenses';
import { spendingWindow } from '../../askIntent';
import { expenseInWindow, recordedAmount } from '../../expenseWindow';

export const spendingTool: LucyTool = {
  name: 'spending',
  description: "Money the user SPENT or PAID — totals and breakdowns by category and time window (today, this week, this/last month, this year, all-time). Use for 'how much did I spend', 'my spending on food', 'total payments'. NOT for income, savings, or budgets.",
  async run(ctx, args) {
    const question = String(args.question ?? '');
    const win = spendingWindow(question);
    const now = new Date();
    const expenses = (await listExpenses(ctx.db)).filter((e) => expenseInWindow(e.created_at, win, now));
    const total = expenses.reduce((s, e) => s + recordedAmount(e), 0);
    const byCat = new Map<string, number>();
    for (const e of expenses) byCat.set(e.category, (byCat.get(e.category) ?? 0) + recordedAmount(e));
    const categories = [...byCat.entries()].map(([category, t]) => ({ category, total: t })).sort((a, b) => b.total - a.total);
    const prose = expenses.length
      ? `You spent ${total.toFixed(2)} ${win.label} across ${expenses.length} payment${expenses.length === 1 ? '' : 's'}`
        + (categories.length ? ` — top: ${categories.slice(0, 3).map((c) => `${c.category} ${c.total.toFixed(2)}`).join(', ')}.` : '.')
      : `No recorded payments ${win.label}.`;
    return { kind: 'spending', data: { total, window: win.label, count: expenses.length, categories }, prose };
  },
};
