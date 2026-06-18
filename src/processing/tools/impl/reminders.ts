/** Reminders tool — the user's pending reminders + when they fire. Wraps listReminders. */
import type { LucyTool } from '../types';
import { listReminders } from '../../../db/reminders';

export const remindersTool: LucyTool = {
  name: 'reminders',
  description: "The user's pending reminders and when they fire — 'what reminders do I have', 'remind me of anything today', 'what am I being reminded about'. For LISTING reminders (not creating a new one).",
  async run(ctx, args) {
    void args;
    const rows = await listReminders(ctx.db);
    const when = (iso: string | null) => {
      if (!iso) return 'no time set';
      const d = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`);
      return Number.isNaN(d.getTime()) ? 'no time set' : d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    };
    const lines = rows.slice(0, 12).map((r) => `- ${r.text} · ${when(r.remind_at ?? null)}${r.recurrence ? ` (repeats ${r.recurrence})` : ''}`);
    const prose = rows.length ? `${rows.length} pending reminder${rows.length === 1 ? '' : 's'}:\n${lines.join('\n')}` : 'No pending reminders.';
    return { kind: 'reminders', data: { count: rows.length }, prose };
  },
};
