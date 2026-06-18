/** Health tool — answers from the user's body profile, energy, intake, activity + meds. Wraps
 *  buildHealthContextPrefix (which already includes medications). Safety red-flag stays in askLucy. */
import type { LucyTool } from '../types';

export const healthTool: LucyTool = {
  name: 'health',
  description: "The user's health, nutrition, weight, calories, energy/TDEE, activity, sleep, and MEDICATIONS — 'how am I doing', 'how many calories left', 'what meds am I on', 'can I lose weight'. Wellness guidance only, never medical/drug advice.",
  async run(ctx, args) {
    void args;
    const { buildHealthContextPrefix } = await import('../../healthSummary');
    const prefix = await buildHealthContextPrefix(ctx.db);
    const prose = prefix.trim()
      ? `${prefix}\n(Use this to answer warmly + ED-safe; never give medical or drug-dose advice.)`
      : 'No health profile or data yet — invite the user to set up their profile in Health.';
    return { kind: 'health', data: { hasData: !!prefix.trim() }, prose };
  },
};
