/** Memory tool — recalls the user's captured notes relevant to a question (vector + BM25 via
 *  findSimilarCaptures) and returns them as context for synthesis. The default catch-all tool. */
import type { LucyTool } from '../types';
import { findSimilarCaptures } from '../../vectorSearch';

export const memoryTool: LucyTool = {
  name: 'memory',
  description: "Recall and answer from the user's own captured notes, thoughts, meetings, ideas, decisions, and history. Use for 'what did I say about X', 'tell me about <person/project>', 'what was that idea', and any general question grounded in their memory. The default when no other tool fits better.",
  async run(ctx, args) {
    const question = String(args.question ?? '');
    const hits = await findSimilarCaptures(ctx.db, question, 6).catch(() => []);
    const sources = hits.map((h) => ({
      captureId: h.capture.id,
      title: h.capture.extracted_title ?? 'Memory',
      snippet: (h.capture.raw_transcript ?? '').slice(0, 100),
    }));
    const context = hits
      .map((h) => {
        const date = new Date(h.capture.created_at.includes('T') ? h.capture.created_at : `${h.capture.created_at.replace(' ', 'T')}Z`).toLocaleDateString();
        return `[${date}${h.capture.extracted_title ? ` · ${h.capture.extracted_title}` : ''}] ${(h.capture.raw_transcript ?? '').slice(0, 400)}`;
      })
      .join('\n---\n');
    const prose = context
      ? `Relevant captured memories:\n${context}`
      : 'No captured notes matched this question.';
    return { kind: 'memory', data: { matched: hits.length }, prose, sources };
  },
};
