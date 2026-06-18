/**
 * Calorie / energy-balance engine — PURE, deterministic, unit-testable (no I/O).
 *
 * Honest framing (per docs/HEALTH_STRATEGY.md):
 *  - BMR via Mifflin-St-Jeor (Katch-McArdle when body-fat is known).
 *  - TDEE = BMR + MEASURED active energy. Only fall back to a BMR×activity-factor multiplier when no
 *    measured active energy exists — never both (the classic double-count bug).
 *  - Net = Intake − TDEE, surfaced as a 7-day rolling average (a trend, never a daily moral verdict).
 *  - Goals are SAFETY-CLAMPED: calorie floor, capped deficit, sane macro split (ED-safe).
 */

export type Sex = 'male' | 'female';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
export type GoalKind = 'lose' | 'maintain' | 'gain';

export interface BodyProfile {
  sex: Sex;
  birthYear: number;
  heightCm: number;
  weightKg: number;
  bodyFatPct?: number | null;
  activityLevel: ActivityLevel;
  goal: GoalKind;
}

/** Adult daily calorie floor — never recommend below this (ED safety). */
export const CALORIE_FLOOR = 1200;
/** Max sustainable daily deficit we'll ever target. */
export const MAX_DEFICIT = 500;
/** Max gentle daily surplus for "gain". */
export const MAX_SURPLUS = 500;

const ACTIVITY_FACTOR: Record<ActivityLevel, number> = {
  sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9,
};

export function ageFromBirthYear(birthYear: number, now = new Date()): number {
  const a = now.getFullYear() - birthYear;
  return a > 0 && a < 130 ? a : 30; // sane fallback
}

/** Mifflin-St-Jeor BMR (kcal/day). */
export function bmrMifflin(p: { sex: Sex; weightKg: number; heightCm: number; age: number }): number {
  const base = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age;
  return Math.round(base + (p.sex === 'male' ? 5 : -161));
}

/** Katch-McArdle BMR when body-fat% is known: 370 + 21.6 × lean body mass(kg). */
export function bmrKatch(weightKg: number, bodyFatPct: number): number {
  const lbm = weightKg * (1 - bodyFatPct / 100);
  return Math.round(370 + 21.6 * lbm);
}

/** Best BMR for a profile — Katch-McArdle if body-fat known, else Mifflin. */
export function bmrFor(profile: BodyProfile): number {
  if (profile.bodyFatPct && profile.bodyFatPct > 0 && profile.bodyFatPct < 75) {
    return bmrKatch(profile.weightKg, profile.bodyFatPct);
  }
  return bmrMifflin({ sex: profile.sex, weightKg: profile.weightKg, heightCm: profile.heightCm, age: ageFromBirthYear(profile.birthYear) });
}

/**
 * Total daily energy expenditure. If `activeEnergyKcal` is a real measured value (HealthKit), add it
 * to BMR. Otherwise estimate via the activity-factor multiplier. NEVER do both.
 */
export function tdee(args: { bmr: number; activeEnergyKcal?: number | null; activityLevel: ActivityLevel }): { tdee: number; source: 'measured' | 'estimated' } {
  if (typeof args.activeEnergyKcal === 'number' && args.activeEnergyKcal > 0) {
    return { tdee: Math.round(args.bmr + args.activeEnergyKcal), source: 'measured' };
  }
  return { tdee: Math.round(args.bmr * ACTIVITY_FACTOR[args.activityLevel]), source: 'estimated' };
}

/** Rough steps→kcal estimate (labelled "estimated" upstream). ~weight-scaled per-step cost. */
export function stepsToKcal(steps: number, weightKg: number): number {
  if (!steps || steps < 0) return 0;
  const perStep = Math.max(0.02, weightKg * 0.0005); // ~0.035 kcal/step at 70kg
  return Math.round(steps * perStep);
}

/** Net energy balance for a day (intake − expenditure). Negative = deficit. */
export function netCalorie(intakeKcal: number, tdeeKcal: number): number {
  return Math.round((intakeKcal || 0) - (tdeeKcal || 0));
}

/** Mean of the finite numbers (ignores null/NaN). Used for the 7-day rolling net average. */
export function rollingAverage(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (!nums.length) return null;
  return Math.round(nums.reduce((s, n) => s + n, 0) / nums.length);
}

/**
 * Safety-clamped daily calorie goal for a profile + its measured/typical TDEE.
 * lose → deficit capped at MAX_DEFICIT and never below CALORIE_FLOOR; gain → capped surplus; maintain → TDEE.
 */
export function safeCalorieGoal(goal: GoalKind, tdeeKcal: number): number {
  if (tdeeKcal <= 0) return CALORIE_FLOOR;
  if (goal === 'lose') return Math.max(CALORIE_FLOOR, Math.round(tdeeKcal - MAX_DEFICIT));
  if (goal === 'gain') return Math.round(tdeeKcal + MAX_SURPLUS);
  return Math.round(tdeeKcal);
}

export interface MacroTargets { calories: number; protein_g: number; carbs_g: number; fat_g: number; }

/**
 * Macro split from a calorie goal: protein ~1.6 g/kg (clamped), fat ~27% of calories, carbs = remainder.
 * 4/4/9 kcal per g for protein/carbs/fat.
 */
export function macroTargets(calorieGoal: number, weightKg: number): MacroTargets {
  const cals = Math.max(CALORIE_FLOOR, Math.round(calorieGoal));
  const protein_g = Math.round(Math.min(2.2, Math.max(1.2, 1.6)) * weightKg);
  const fatCals = cals * 0.27;
  const fat_g = Math.round(fatCals / 9);
  const remainingCals = Math.max(0, cals - protein_g * 4 - fat_g * 9);
  const carbs_g = Math.round(remainingCals / 4);
  return { calories: cals, protein_g, carbs_g, fat_g };
}

/** Sum logged-food rows into a day's nutrition totals. */
export interface FoodMacros { calories?: number | null; protein_g?: number | null; carbs_g?: number | null; fat_g?: number | null; }
export function sumNutrition(items: FoodMacros[]): MacroTargets {
  const t = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
  for (const i of items) {
    t.calories += i.calories ?? 0;
    t.protein_g += i.protein_g ?? 0;
    t.carbs_g += i.carbs_g ?? 0;
    t.fat_g += i.fat_g ?? 0;
  }
  return { calories: Math.round(t.calories), protein_g: Math.round(t.protein_g), carbs_g: Math.round(t.carbs_g), fat_g: Math.round(t.fat_g) };
}
