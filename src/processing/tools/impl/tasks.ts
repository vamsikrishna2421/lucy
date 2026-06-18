/** Tasks tool — the user's pending to-dos (optionally scoped to "today"). Wraps listPendingTodos. */
import type { LucyTool } from '../types';
import { listPendingTodos } from '../../../db/todos';

export const tasksTool: LucyTool = {
  name: 'tasks',
  description: "The user's open to-dos / tasks / pending action items — 'what are my tasks', 'what do I need to do today', 'what's pending'. Use for to-do lists, NOT calendar scheduling of a new activity.",
  async run(ctx, args) {
    const q = String(args.question ?? '').toLowerCase();
    const todays = /\b(today|for today|this day)\b/.test(q);
    const all = await listPendingTodos(ctx.db);
    const urg = (t: { urgency?: string | null }) => (t.urgency === 'high' ? 0 : t.urgency === 'low' ? 2 : 1);
    const tasks = [...all].sort((a, b) => urg(a) - urg(b));
    const lines = tasks.slice(0, 12).map((t) => `- ${t.task}${t.urgency === 'high' ? ' (urgent)' : ''}`);
    const prose = tasks.length
      ? `${tasks.length} open task${tasks.length === 1 ? '' : 's'}${todays ? ' (showing your list)' : ''}:\n${lines.join('\n')}`
      : 'No open tasks right now.';
    return { kind: 'tasks', data: { count: tasks.length, tasks: tasks.slice(0, 12).map((t) => ({ task: t.task, urgency: t.urgency ?? null })) }, prose };
  },
};
