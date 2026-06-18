/** People tool — who the user knows + the context LUCY has on them. Reads the people table; if the
 *  question names a person, focuses on them, else lists the most-recent contacts. */
import type { LucyTool } from '../types';

export const peopleTool: LucyTool = {
  name: 'people',
  description: "People the user knows and what LUCY remembers about them — 'who is <name>', 'tell me about <person>', 'who have I been talking to', relationships and contacts.",
  async run(ctx, args) {
    const q = String(args.question ?? '').toLowerCase();
    const rows = await ctx.db.getAllAsync<{ name: string; context: string | null; last_mentioned: string | null }>(
      'SELECT name, context, last_mentioned FROM people ORDER BY last_mentioned IS NULL, last_mentioned DESC LIMIT 60',
    ).catch(() => [] as Array<{ name: string; context: string | null; last_mentioned: string | null }>);
    if (!rows.length) return { kind: 'people', data: { count: 0 }, prose: "No people captured yet." };
    // If the question names someone, focus on them.
    const named = rows.filter((r) => r.name && q.includes(r.name.toLowerCase().split(/\s+/)[0]));
    const pick = named.length ? named : rows.slice(0, 8);
    const prose = pick.map((r) => `- ${r.name}${r.context ? `: ${r.context.slice(0, 160)}` : ''}`).join('\n');
    return { kind: 'people', data: { count: pick.length, focused: named.length > 0 }, prose: `What I remember:\n${prose}` };
  },
};
