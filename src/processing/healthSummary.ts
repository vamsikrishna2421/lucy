/**
 * Health summary — fuses activity (health_snapshots), intake (food_log), and the body profile through
 * the pure calorie engine into one daily picture for the Health UI, the web mirror, and Dr. Lucy.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import {
  bmrFor, tdee, stepsToKcal, netCalorie, rollingAverage, safeCalorieGoal, macroTargets,
  type BodyProfile,
} from './calorieEngine';
import {
  getBodyProfile, getNutritionGoals, listFoodLog, dailyIntakeTotals, todayKey, type FoodLogRow,
} from '../db/healthNutrition';

export interface HealthSummary {
  date: string;
  profileComplete: boolean;
  activity: { steps: number; sleep_hours: number | null; resting_hr: number | null; active_minutes: number | null; active_energy_kcal: number | null; active_energy_source: 'measured' | 'estimated' | 'absent' };
  energy: { bmr: number | null; tdee: number | null; tdee_source: 'measured' | 'estimated' | null };
  intake: { calories: number; protein_g: number; carbs_g: number; fat_g: number; items: FoodLogRow[] };
  goals: { calorie_goal: number; protein_g: number; carbs_g: number; fat_g: number } | null;
  remaining: number | null;        // goal − intake (calories)
  net: number | null;              // intake − tdee today
  net_rolling_7: number | null;    // 7-day rolling average net (trend, not a verdict)
  drLucy: import('./drLucy').GuardianGuidance[]; // gentle, grounded guardian guidance (may be empty)
}

export async function getHealthSummary(db: SQLiteDatabase, dateKey = todayKey()): Promise<HealthSummary> {
  const [profileRow, goalsRow, foods, intakeDays] = await Promise.all([
    getBodyProfile(db),
    getNutritionGoals(db),
    listFoodLog(db, dateKey),
    dailyIntakeTotals(db, 7),
  ]);

  // Today's activity (best-effort from health_snapshots).
  const snap = await db.getFirstAsync<{ steps: number; sleep_hours: number | null; resting_hr: number | null; active_minutes: number | null }>(
    'SELECT steps, sleep_hours, resting_hr, active_minutes FROM health_snapshots WHERE date_key = ?', dateKey,
  ).catch(() => null);
  const steps = snap?.steps ?? 0;

  const profileComplete = !!(profileRow && profileRow.sex && profileRow.height_cm && profileRow.weight_kg && profileRow.birth_year);
  const weightKg = profileRow?.weight_kg ?? 70;

  // We don't yet read HealthKit active-energy directly here → estimate from steps (labelled estimated).
  const estActive = stepsToKcal(steps, weightKg);
  const activeEnergy = estActive > 0 ? estActive : null;

  let bmr: number | null = null;
  let tdeeVal: number | null = null;
  let tdeeSource: 'measured' | 'estimated' | null = null;
  if (profileComplete) {
    const bp: BodyProfile = {
      sex: profileRow!.sex as BodyProfile['sex'], birthYear: profileRow!.birth_year!,
      heightCm: profileRow!.height_cm!, weightKg, bodyFatPct: profileRow!.body_fat_pct,
      activityLevel: (profileRow!.activity_level as BodyProfile['activityLevel']) ?? 'moderate',
      goal: (profileRow!.goal as BodyProfile['goal']) ?? 'maintain',
    };
    bmr = bmrFor(bp);
    const t = tdee({ bmr, activeEnergyKcal: activeEnergy, activityLevel: bp.activityLevel });
    tdeeVal = t.tdee; tdeeSource = t.source;
  }

  // Intake today.
  const intakeCalories = foods.reduce((s, f) => s + (f.calories ?? 0), 0);
  const intake = {
    calories: Math.round(intakeCalories),
    protein_g: Math.round(foods.reduce((s, f) => s + (f.protein_g ?? 0), 0)),
    carbs_g: Math.round(foods.reduce((s, f) => s + (f.carbs_g ?? 0), 0)),
    fat_g: Math.round(foods.reduce((s, f) => s + (f.fat_g ?? 0), 0)),
    items: foods,
  };

  // Goals: explicit nutrition_goals, else derive from profile+TDEE (safe-clamped), else null.
  let goals: HealthSummary['goals'] = null;
  if (goalsRow?.calorie_goal) {
    goals = {
      calorie_goal: goalsRow.calorie_goal,
      protein_g: goalsRow.protein_g ?? macroTargets(goalsRow.calorie_goal, weightKg).protein_g,
      carbs_g: goalsRow.carbs_g ?? macroTargets(goalsRow.calorie_goal, weightKg).carbs_g,
      fat_g: goalsRow.fat_g ?? macroTargets(goalsRow.calorie_goal, weightKg).fat_g,
    };
  } else if (profileComplete && tdeeVal) {
    const cal = safeCalorieGoal((profileRow!.goal as BodyProfile['goal']) ?? 'maintain', tdeeVal);
    goals = { calorie_goal: cal, ...macroTargets(cal, weightKg) };
  }

  const remaining = goals ? Math.round(goals.calorie_goal - intake.calories) : null;
  const net = tdeeVal != null ? netCalorie(intake.calories, tdeeVal) : null;

  // Personal baselines for Dr. Lucy (mean RHR/sleep over ~21 days).
  const baseRow = await db.getFirstAsync<{ rhr: number | null; sleep: number | null }>(
    `SELECT AVG(resting_hr) AS rhr, AVG(sleep_hours) AS sleep FROM health_snapshots WHERE date_key >= date('now','-21 days')`,
  ).catch(() => null);

  // 7-day rolling net needs both intake and a per-day TDEE; we approximate TDEE as today's TDEE
  // (body profile is stable) and pair it with each day's logged intake (only days with food logged).
  const net7 = (tdeeVal != null)
    ? rollingAverage(intakeDays.filter((d) => d.calories > 0).map((d) => netCalorie(d.calories, tdeeVal!)))
    : null;

  const summary: HealthSummary = {
    date: dateKey,
    profileComplete,
    activity: {
      steps, sleep_hours: snap?.sleep_hours ?? null, resting_hr: snap?.resting_hr ?? null,
      active_minutes: snap?.active_minutes ?? null,
      active_energy_kcal: activeEnergy,
      active_energy_source: activeEnergy != null ? 'estimated' : 'absent',
    },
    energy: { bmr, tdee: tdeeVal, tdee_source: tdeeSource },
    intake,
    goals,
    remaining,
    net,
    net_rolling_7: net7,
    drLucy: [],
  };

  // Dr. Lucy's grounded, gentle guidance (deterministic; may be empty).
  try {
    const { evaluateGuardian } = await import('./drLucy');
    summary.drLucy = evaluateGuardian(summary, { resting_hr: baseRow?.rhr ?? null, sleep_hours: baseRow?.sleep ?? null });
  } catch { /* guidance is non-critical */ }

  return summary;
}
