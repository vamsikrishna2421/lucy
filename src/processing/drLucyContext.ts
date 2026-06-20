/**
 * Dr. Lucy — CONTEXTUAL guardian (the retention differentiator from docs/INDIA_HEALTH_RESEARCH.md).
 * Connects what LUCY already knows — meals, mood, sleep — into grounded, human cross-domain observations
 * ("you skipped a midday meal and ate late", "your stressful days run higher-calorie"). PURE + deterministic
 * + unit-tested, exactly like drLucy.ts: the engine decides WHAT to say (grounded in the user's own data,
 * no medical claims, ED-safe — never moralizes food or tells the user to eat less); the LLM only voices it.
 */
import type { GuardianGuidance } from './drLucy';

export interface DayContext {
  dateKey: string;            // YYYY-MM-DD, days[] ordered most-recent-first
  calories: number;           // total intake logged that day (0 = nothing logged)
  carbs_g: number;
  meals: Array<{ mealType: string; hour: number }>; // logged meals with local hour-of-day
  stressed: boolean;          // that day's mood skewed stressed/negative/frustrated
  sleep_hours: number | null;
}

const avg = (a: number[]): number => Math.round(a.reduce((s, x) => s + x, 0) / a.length);

/** Cross-domain, grounded guidance from recent days (most-recent-first). At most 2, gentle severity. */
export function contextualGuidance(days: DayContext[]): GuardianGuidance[] {
  const out: GuardianGuidance[] = [];
  const withFood = days.filter((d) => d.calories > 0 || d.meals.length > 0);

  // A) Skipped a midday meal → ended up eating late (within the most recent logged day).
  const recent = withFood[0];
  if (recent && recent.meals.length >= 2) {
    const hadMidday = recent.meals.some((m) => m.mealType === 'lunch' || (m.hour >= 12 && m.hour < 15));
    const ateLate = recent.meals.some((m) => m.hour >= 20);
    if (!hadMidday && ateLate) {
      out.push({
        category: 'nutrition', severity: 'gentle',
        observation: 'You skipped a proper midday meal and ended up eating late.',
        suggestion: 'A lunch tomorrow could steady your evening hunger.',
      });
    }
  }

  // B) Mood ↔ intake: stressful days running notably higher-calorie than calm ones.
  const stressedCals = withFood.filter((d) => d.stressed && d.calories > 0).map((d) => d.calories);
  const calmCals = withFood.filter((d) => !d.stressed && d.calories > 0).map((d) => d.calories);
  if (stressedCals.length >= 2 && calmCals.length >= 2) {
    const s = avg(stressedCals); const c = avg(calmCals);
    if (s >= c * 1.15) {
      out.push({
        category: 'nutrition', severity: 'gentle',
        observation: `Your more stressful days have run higher-calorie lately (about ${s} vs ${c} on calmer days).`,
        suggestion: 'On a tense day, a planned snack can head off the evening spike — no judgement either way.',
      });
    }
  }

  return out.slice(0, 2);
}
