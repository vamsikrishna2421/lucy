/** People tool — who the user knows + the context LUCY has on them. Combines the people table with
 *  related captures (so "who is X" gets the FULL picture — work + personal — matching the memory
 *  recall path, not just the one-line people.context). */
import type { LucyTool } from '../types';

export const peopleTool: LucyTool = {
  name: 'people',
  description: "People the user knows and what LUCY remembers about them — 'who is <name>', 'tell me about <person>', 'who have I been talking to', relationships and contacts.",
  async run(ctx, args) {
    const q = String(args.question ?? '');
    const ql = q.toLowerCase();
    const rows = await ctx.db.getAllAsync<{ name: string; context: string | null; last_mentioned: string | null }>(
      'SELECT name, context, last_mentioned FROM people ORDER BY last_mentioned IS NULL, last_mentioned DESC LIMIT 60',
    ).catch(() => [] as Array<{ name: string; context: string | null; last_mentioned: string | null }>);
    if (!rows.length) return { kind: 'people', data: { count: 0 }, prose: 'No people captured yet.' };

    // If the question names someone, focus + enrich with related captures (full context, like memory).
    const named = rows.filter((r) => r.name && ql.includes(r.name.toLowerCase().split(/\s+/)[0]));
    if (named.length) {
      const person = named[0];
      let captureContext = '';
      let sources: Array<{ captureId: number; title: string; snippet?: string }> = [];
      try {
        const { findSimilarCaptures } = await import('../../vectorSearch');
        const hits = await findSimilarCaptures(ctx.db, person.name, 5);
        sources = hits.map((h) => ({ captureId: h.capture.id, title: h.capture.extracted_title ?? 'Memory', snippet: (h.capture.raw_transcript ?? '').slice(0, 100) }));
        captureContext = hits.map((h) => `- ${(h.capture.raw_transcript ?? '').slice(0, 300)}`).join('\n');
      } catch { /* enrichment optional */ }
      const prose = `What I remember about ${person.name}:`
        + (person.context ? `\n${person.context}` : '')
        + (captureContext ? `\nFrom your notes:\n${captureContext}` : '');
      return { kind: 'people', data: { focused: person.name }, prose, sources };
    }

    // Otherwise list the most-recent contacts.
    const prose = rows.slice(0, 8).map((r) => `- ${r.name}${r.context ? `: ${r.context.slice(0, 140)}` : ''}`).join('\n');
    return { kind: 'people', data: { count: rows.length, focused: false }, prose: `People you've mentioned recently:\n${prose}` };
  },
};
