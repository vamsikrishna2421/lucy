/** Shared expense-window helpers (used by the spending answer + the spending tool). Pure. */
import type { ExpenseRow } from '../db/expenses';
import type { SpendingWindow } from './askIntent';

export function expenseInWindow(createdAt: string, win: SpendingWindow, now = new Date()): boolean {
  if (win.kind === 'all') return true;
  const t = new Date(`${createdAt.replace(' ', 'T')}Z`).getTime();
  if (!Number.isFinite(t)) return false;
  const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
  switch (win.kind) {
    case 'today': return t >= startOfToday.getTime();
    case 'week': return t >= now.getTime() - 7 * 86_400_000;
    case 'month': return t >= new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    case 'lastMonth': {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
      const end = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      return t >= start && t < end;
    }
    case 'year': return t >= new Date(now.getFullYear(), 0, 1).getTime();
    default: return true;
  }
}

export function recordedAmount(expense: ExpenseRow): number {
  return typeof expense.amount === 'number' && Number.isFinite(expense.amount) ? expense.amount : 0;
}
