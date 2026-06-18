/**
 * Dr. Lucy — caring health guardian. SAFETY-FIRST, deterministic decisions; the LLM only *voices* what
 * this engine already decided (it never invents medical triggers from raw data).
 *
 * Non-negotiable guardrails (docs/HEALTH_STRATEGY.md):
 *  - Not a doctor / medical device. No diagnosis, prescription, or test interpretation.
 *  - RED-FLAG classifier runs FIRST and HARD-OVERRIDES: emergency/crisis symptoms drop all self-care
 *    advice and urge professional / emergency help + crisis resources.
 *  - ED-SAFE: respect a calorie floor, never gamify eating less, never moralize food; treat very-low
 *    intake as a CARE event, not praise.
 *
 * The pure functions here (detectRedFlag, assessIntake, evaluateGuardian) are unit-tested.
 */
import type { HealthSummary } from './healthSummary';
import { CALORIE_FLOOR } from './calorieEngine';

export const DR_LUCY_DISCLAIMER =
  'I’m Lucy — a caring companion, not a doctor. I can notice patterns and nudge gently, but I can’t diagnose or treat. For anything medical, please see a professional.';

export type Severity = 'care' | 'gentle' | 'caution' | 'emergency';
export interface GuardianGuidance {
  category: 'nutrition' | 'activity' | 'sleep' | 'heart' | 'hydration' | 'safety';
  severity: Severity;
  /** The grounded observation the LLM should voice (it must not add new facts). */
  observation: string;
  /** At most one gentle suggestion. */
  suggestion?: string;
}

// ── RED-FLAG SAFETY CLASSIFIER (runs first, hard override) ──────────────────────
const RED_FLAGS: Array<{ re: RegExp; kind: string }> = [
  { re: /\b(chest pain|chest tightness|pain in (my )?chest|crushing chest)\b/i, kind: 'cardiac' },
  { re: /\b(can'?t breathe|cannot breathe|short(ness)? of breath|struggling to breathe|gasping)\b/i, kind: 'breathing' },
  { re: /(face[^.]{0,15}droop|droop[^.]{0,15}face|slur[^.]{0,15}speech|speech[^.]{0,15}slur|\bslurred\b|numb (on )?one side|can'?t move (my )?(arm|leg)|\bstroke\b)/i, kind: 'stroke' },
  { re: /\b(suicidal|kill myself|end my life|want to die|self[- ]harm|hurt myself)\b/i, kind: 'crisis' },
  { re: /\b(severe bleeding|won'?t stop bleeding|coughing up blood|vomiting blood)\b/i, kind: 'bleeding' },
  { re: /\b(overdose|took too many pills|poison(ed)?)\b/i, kind: 'overdose' },
  { re: /\b(fainted|passed out|unconscious|seizure|convulsion)\b/i, kind: 'collapse' },
];

export interface RedFlag { kind: string; message: string; }

/** Scans free text (e.g. a question to Dr. Lucy) for emergency symptoms. Returns a crisis response or null. */
export function detectRedFlag(text: string): RedFlag | null {
  const t = (text || '').toLowerCase();
  for (const f of RED_FLAGS) {
    if (f.re.test(t)) {
      const message = f.kind === 'crisis'
        ? 'I’m really glad you told me. I can’t help with this myself, but you deserve immediate support — please reach out right now to a crisis line (in the US, call or text 988) or someone you trust. If you’re in danger, call your local emergency number.'
        : 'This could be serious and needs real medical help now — please call your local emergency number or get to urgent care. I can’t assess symptoms, and I don’t want you to wait on me for this.';
      return { kind: f.kind, message };
    }
  }
  return null;
}

// ── ED-SAFE INTAKE ASSESSMENT ───────────────────────────────────────────────────
export interface IntakeSafety { tooLow: boolean; observation: string | null; }
/**
 * Treat very-low intake as a CARE event, never praise. Only flags late in the day (so a not-yet-logged
 * lunch isn't misread). Never tells the user to eat less.
 */
export function assessIntake(summary: HealthSummary, hour = new Date().getHours()): IntakeSafety {
  const cals = summary.intake.calories;
  // Only meaningful once there's some intake logged and it's evening-ish.
  if (!summary.profileComplete) return { tooLow: false, observation: null };
  if (hour >= 19 && cals > 0 && cals < CALORIE_FLOOR) {
    return { tooLow: true, observation: `You've logged only about ${cals} calories today — that's quite low. Please make sure you eat enough; fuelling yourself matters more than any target.` };
  }
  return { tooLow: false, observation: null };
}

export interface Baselines { resting_hr?: number | null; sleep_hours?: number | null; }

/**
 * Deterministic guardian evaluation → at most TWO guidance items (care/safety first), grounded only in
 * the summary. No medical claims. Returns [] when nothing rises to the bar (silence is fine).
 */
export function evaluateGuardian(summary: HealthSummary, baselines: Baselines = {}, hour = new Date().getHours()): GuardianGuidance[] {
  const out: GuardianGuidance[] = [];

  // 1) ED-safe intake care comes first.
  const intake = assessIntake(summary, hour);
  if (intake.tooLow && intake.observation) {
    out.push({ category: 'nutrition', severity: 'care', observation: intake.observation, suggestion: 'Even a small, balanced meal would help.' });
  }

  // 2) Over-aggressive deficit trend (ED-safe: flag steep deficits as caution, never encourage them).
  if (summary.net_rolling_7 != null && summary.net_rolling_7 < -800) {
    out.push({ category: 'nutrition', severity: 'caution', observation: `Your 7-day average is running about ${Math.abs(summary.net_rolling_7)} calories under what you burn — that's a steep deficit.`, suggestion: 'Easing up a little will be more sustainable and kinder to your energy.' });
  }

  // 3) Sleep (only if known + short).
  if (typeof summary.activity.sleep_hours === 'number' && summary.activity.sleep_hours > 0 && summary.activity.sleep_hours < 6) {
    out.push({ category: 'sleep', severity: 'gentle', observation: `You got about ${summary.activity.sleep_hours.toFixed(1)} hours of sleep — on the short side.`, suggestion: 'An earlier wind-down tonight could help you recover.' });
  }

  // 4) Resting HR elevated vs personal baseline (observation only, never diagnosis).
  if (typeof summary.activity.resting_hr === 'number' && typeof baselines.resting_hr === 'number' && summary.activity.resting_hr >= baselines.resting_hr + 8) {
    out.push({ category: 'heart', severity: 'caution', observation: `Your resting heart rate (${summary.activity.resting_hr}) is noticeably above your usual ~${baselines.resting_hr}.`, suggestion: 'Could be stress, poor sleep, or coming down with something — worth taking it easy. If it persists or you feel unwell, check with a professional.' });
  }

  // 5) Low movement nudge (gentle, evening only, non-judgmental).
  if (hour >= 18 && summary.activity.steps > 0 && summary.activity.steps < 2000) {
    out.push({ category: 'activity', severity: 'gentle', observation: `Today's been a quiet movement day (~${summary.activity.steps} steps).`, suggestion: 'A short walk would feel good if you have the energy.' });
  }

  // Care + safety first, then by severity; cap at 2 so it never nags.
  const order: Record<Severity, number> = { emergency: 0, care: 1, caution: 2, gentle: 3 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]).slice(0, 2);
}

/**
 * Voice a single decided guidance through the LLM as warm "Dr. Lucy" (runtime; the engine already
 * decided WHAT to say + the severity — the model only phrases it, never adds facts or medical claims).
 */
export async function voiceGuardian(g: GuardianGuidance): Promise<string> {
  try {
    const { resolveRemoteAvailability } = await import('../ai/provider');
    const { available, openAIKey } = await resolveRemoteAvailability();
    const base = g.suggestion ? `${g.observation} ${g.suggestion}` : g.observation;
    if (!available) return base; // deterministic fallback text is already safe + grounded
    const { promptAI } = await import('../ai/openai');
    const sys = `You are Dr. Lucy, a warm, caring health companion (NOT a doctor — never diagnose, prescribe, or interpret tests). Rephrase the given observation + suggestion into ONE short, gentle, first-person line (under 30 words). Observation first, at most one suggestion. Never add new facts, numbers, or medical claims beyond what's given. Never moralize food or tell the user to eat less. Plain text only.`;
    const raw = await promptAI(sys, `Observation: ${g.observation}\nSuggestion: ${g.suggestion ?? '(none)'}\nSeverity: ${g.severity}`, openAIKey);
    const line = (raw || '').trim();
    return line || base;
  } catch {
    return g.suggestion ? `${g.observation} ${g.suggestion}` : g.observation;
  }
}
