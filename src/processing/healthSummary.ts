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
  intakeLogged: boolean;           // did the user log ANY food today? if false, intake is UNKNOWN (never assume 0/fasting)
  intakeCompleteness: 'none' | 'partial' | 'logged'; // none=0 meals, partial=1-2 (likely missed some), logged=3+
  goals: { calorie_goal: number; protein_g: number; carbs_g: number; fat_g: number } | null;
  remaining: number | null;        // goal − intake (calories)
  net: number | null;              // intake − tdee today (null when nothing logged — intake unknown)
  net_rolling_7: number | null;    // 7-day rolling average net (trend, not a verdict)
  drLucy: import('./drLucy').GuardianGuidance[]; // gentle, grounded guardian guidance (may be empty)
}

/** Detects a health/nutrition/fitness question so we only attach (sensitive) health context when relevant. */
export function isHealthQuestion(q: string): boolean {
  return /\b(weight|kg|lbs|calorie|kcal|lose|losing|gain|gaining|fat|diet|eat|eating|ate|nutrition|bmi|tdee|bmr|macro|protein|carb|fibre|fiber|sugar|meal|food|hydrat|water|fitness|workout|exercise|step|sleep|deficit|surplus|metabolism|burn(ed|ing)?|medication|medicine|meds?|pill|dose|dosage|prescription)\b/i.test(q || '');
}

/**
 * Compact health-context prefix for the Ask/voice LLM so Lucy can answer health questions using the
 * user's OWN profile + today's data (weight, goal, BMR/TDEE, intake) instead of claiming it has none.
 * Returns '' when there's no body profile. (The user is asking a health question + has remote AI on.)
 */
export async function buildHealthContextPrefix(db: SQLiteDatabase): Promise<string> {
  try {
    // Active medications — answer "what meds am I on / when do I take X" from the user's own list.
    let medsLine = '';
    try {
      const { listMedications, parseTimes } = await import('../db/medications');
      const meds = await listMedications(db);
      if (meds.length) {
        medsLine = `- Medications (tracker only — never advise on drugs/doses): ${meds.map((m) => `${m.name}${m.dosage ? ` ${m.dosage}` : ''}${parseTimes(m.times).length ? ` at ${parseTimes(m.times).join(', ')}` : ''}`).join('; ')}.`;
      }
    } catch { /* meds optional */ }

    const s = await getHealthSummary(db);
    const p = await getBodyProfile(db);
    // If there's no body profile but the user tracks meds, still answer from the meds list.
    if (!s.profileComplete || !p) return medsLine ? `The user's health info (use this; do NOT say you lack their data):\n${medsLine}\n` : '';
    const age = p.birth_year ? new Date().getFullYear() - p.birth_year : null;
    const parts = [
      `The user's health profile (use this to answer; do NOT say you lack their data):`,
      `- Body: ${p.sex ?? '?'}, ${age ?? '?'}y, ${p.height_cm ?? '?'}cm, ${p.weight_kg ?? '?'}kg, activity ${p.activity_level}, goal "${p.goal}"${p.body_fat_pct ? `, ${p.body_fat_pct}% body fat` : ''}.`,
      `- Energy: BMR ${s.energy.bmr ?? '?'} kcal, TDEE ${s.energy.tdee ?? '?'} kcal (${s.energy.tdee_source ?? 'n/a'}).`,
      s.goals ? `- Daily goal: ${s.goals.calorie_goal} kcal (P ${s.goals.protein_g} / C ${s.goals.carbs_g} / F ${s.goals.fat_g} g).` : '',
      !s.intakeLogged
        ? `- Today: NO food logged yet. Intake is UNKNOWN — do NOT assume they fasted, ate nothing, or are in a deficit, and do NOT estimate weight loss from this. They are often just too busy to log. Gently invite them to snap a photo of their next meal. Steps ${s.activity.steps}${s.activity.sleep_hours ? `, slept ${s.activity.sleep_hours}h` : ''}.`
        : s.intakeCompleteness === 'partial'
          ? `- Today so far: ${s.intake.calories} kcal across only a couple of logged meals — this is likely INCOMPLETE (they probably ate more but didn't log it). Do NOT treat ${s.intake.calories} as the full day or infer a deficit/weight-loss from it. Logged: ${s.intake.items.map((i) => i.name).slice(0, 6).join(', ')}. Gently ask if they missed logging any meals or snacks. Steps ${s.activity.steps}${s.activity.sleep_hours ? `, slept ${s.activity.sleep_hours}h` : ''}.`
          : `- Today so far: ${s.intake.calories} kcal eaten${s.remaining != null ? `, ${s.remaining} remaining` : ''}; steps ${s.activity.steps}${s.activity.sleep_hours ? `, slept ${s.activity.sleep_hours}h` : ''}.`,
      s.net_rolling_7 != null ? `- 7-day net average (ONLY across days they actually logged food): ${s.net_rolling_7} kcal/day (trend only — never a verdict; days with no log are excluded, not counted as zero).` : '',
      medsLine,
      `When estimating weight change: ~7700 kcal ≈ 1 kg. Use their TDEE + intake ONLY for days with logged food; never infer fasting or weight loss from missing logs. Be encouraging and ED-safe; never suggest unsafe deficits.`,
      '',
    ].filter(Boolean);
    return parts.join('\n');
  } catch { return ''; }
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

  // Did the user log ANY food today? If not, intake is UNKNOWN — we must NOT treat 0 logged as 0 eaten
  // (that would fabricate a huge deficit / "fasting" / rapid weight-loss assumption from mere laziness).
  const intakeLogged = foods.length > 0;
  // Completeness by distinct meal slots logged: 1-2 likely means the user missed logging meals, so the
  // logged total is NOT the full day — Lucy should ask, not assume. 3+ slots = reasonably complete.
  const mealSlots = new Set(foods.map((f) => f.meal_type).filter(Boolean)).size;
  const intakeCompleteness: HealthSummary['intakeCompleteness'] = mealSlots === 0 ? 'none' : mealSlots < 3 ? 'partial' : 'logged';
  const remaining = goals && intakeLogged ? Math.round(goals.calorie_goal - intake.calories) : null;
  const net = (tdeeVal != null && intakeLogged) ? netCalorie(intake.calories, tdeeVal) : null;

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
    intakeLogged,
    intakeCompleteness,
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

  // Contextual guardian: connect meals ↔ mood ↔ sleep into grounded cross-domain observations.
  try {
    const { contextualGuidance } = await import('./drLucyContext');
    const localDate = (s: string): string => {
      const d = new Date((s || '').replace(' ', 'T') + 'Z');
      return Number.isNaN(d.getTime()) ? (s || '').slice(0, 10)
        : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const localHour = (s: string): number => { const d = new Date((s || '').replace(' ', 'T') + 'Z'); return Number.isNaN(d.getTime()) ? 12 : d.getHours(); };
    const [foods, moods, snaps] = await Promise.all([
      db.getAllAsync<{ date_key: string; meal_type: string | null; calories: number | null; carbs_g: number | null; created_at: string }>(
        "SELECT date_key, meal_type, calories, carbs_g, created_at FROM food_log WHERE date_key >= date('now','-10 days')").catch(() => []),
      db.getAllAsync<{ tone: string; created_at: string }>(
        "SELECT tone, created_at FROM mood_entries WHERE created_at >= datetime('now','-10 days')").catch(() => []),
      db.getAllAsync<{ date_key: string; sleep_hours: number | null }>(
        "SELECT date_key, sleep_hours FROM health_snapshots WHERE date_key >= date('now','-10 days')").catch(() => []),
    ]);
    type Acc = { calories: number; carbs: number; meals: Array<{ mealType: string; hour: number }>; sleep: number | null; stressedN: number; calmN: number };
    const byDate = new Map<string, Acc>();
    const acc = (d: string): Acc => { let g = byDate.get(d); if (!g) { g = { calories: 0, carbs: 0, meals: [], sleep: null, stressedN: 0, calmN: 0 }; byDate.set(d, g); } return g; };
    for (const f of foods) { const g = acc(f.date_key); g.calories += f.calories ?? 0; g.carbs += f.carbs_g ?? 0; g.meals.push({ mealType: (f.meal_type || '').toLowerCase(), hour: localHour(f.created_at) }); }
    for (const s of snaps) { if (s.sleep_hours != null) acc(s.date_key).sleep = s.sleep_hours; }
    const STRESS = new Set(['stressed', 'negative', 'frustrated']); const CALM = new Set(['positive', 'excited', 'calm']);
    for (const m of moods) { const g = acc(localDate(m.created_at)); if (STRESS.has(m.tone)) g.stressedN += 1; else if (CALM.has(m.tone)) g.calmN += 1; }
    const contexts = [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([dateKey, g]) => ({
      dateKey, calories: Math.round(g.calories), carbs_g: Math.round(g.carbs), meals: g.meals,
      stressed: g.stressedN > 0 && g.stressedN >= g.calmN, sleep_hours: g.sleep,
    }));
    const ctx = contextualGuidance(contexts);
    if (ctx.length) summary.drLucy = [...summary.drLucy, ...ctx].slice(0, 3);
  } catch { /* contextual guidance is non-critical */ }

  return summary;
}
