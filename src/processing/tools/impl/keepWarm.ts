/** Keep-in-touch tool — people the user has fallen out of touch with and may want to reach out to.
 *  Distinct from `people` (facts ABOUT a specific person). */
import type { LucyTool } from '../types';

export const keepWarmTool: LucyTool = {
  name: 'keep_in_touch',
  description: "People you've gone quiet with and may want to reach out to — use for 'who haven't I talked to', 'who should I reach out to', 'am I neglecting anyone', 'who's gone quiet'. For facts ABOUT a specific person, use the people tool instead.",
  async run(ctx) {
    const { getKeepWarmNudges } = await import('../../relationshipEngine');
    const nudges = await getKeepWarmNudges(ctx.db);
    const prose = nudges.length
      ? nudges.map((n) => n.message).join(' ')
      : "You're not noticeably out of touch with anyone right now — the people you mention regularly are all recent.";
    return { kind: 'keep_in_touch', data: { nudges }, prose };
  },
};
