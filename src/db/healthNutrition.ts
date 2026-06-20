import type { SQLiteDatabase } from 'expo-sqlite';
import type { ActivityLevel, GoalKind, Sex } from '../processing/calorieEngine';

/** On-device body profile (single row, id=1). Drives BMR/TDEE. */
export interface BodyProfileRow {
  sex: Sex | null;
  birth_year: number | null;
  height_cm: number | null;
  weight_kg: number | null;
  body_fat_pct: number | null;
  activity_level: ActivityLevel;
  goal: GoalKind;
  gentle_mode: number;
}

export interface NutritionGoalsRow {
  calorie_goal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  water_ml: number | null;
}

export interface FoodLogRow {
  id: number;
  date_key: string;
  meal_type: string | null;
  name: string;
  qty: number | null;
  unit: string | null;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  sugar_g: number | null;
  sodium_mg: number | null;
  source: string | null;        // photo|barcode|voice|text|label
  confidence: string | null;    // high|medium|low
  photo_uri: string | null;
  created_at: string;
}

export function todayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── Body profile ────────────────────────────────────────────────────────────────
export async function getBodyProfile(db: SQLiteDatabase): Promise<BodyProfileRow | null> {
  return db.getFirstAsync<BodyProfileRow>('SELECT * FROM body_profile WHERE id = 1');
}

export async function upsertBodyProfile(db: SQLiteDatabase, p: Partial<BodyProfileRow>): Promise<void> {
  const cur = await getBodyProfile(db);
  const m = { ...cur, ...p };
  await db.runAsync(
    `INSERT INTO body_profile (id, sex, birth_year, height_cm, weight_kg, body_fat_pct, activity_level, goal, gentle_mode, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(id) DO UPDATE SET
       sex=excluded.sex, birth_year=excluded.birth_year, height_cm=excluded.height_cm,
       weight_kg=excluded.weight_kg, body_fat_pct=excluded.body_fat_pct,
       activity_level=excluded.activity_level, goal=excluded.goal, gentle_mode=excluded.gentle_mode,
       updated_at=CURRENT_TIMESTAMP`,
    m.sex ?? null, m.birth_year ?? null, m.height_cm ?? null, m.weight_kg ?? null, m.body_fat_pct ?? null,
    m.activity_level ?? 'moderate', m.goal ?? 'maintain', m.gentle_mode ?? 0,
  );
}

// ── Nutrition goals ───────────────────────────────────────────────────────────
export async function getNutritionGoals(db: SQLiteDatabase): Promise<NutritionGoalsRow | null> {
  return db.getFirstAsync<NutritionGoalsRow>('SELECT * FROM nutrition_goals WHERE id = 1');
}

export async function upsertNutritionGoals(db: SQLiteDatabase, g: NutritionGoalsRow): Promise<void> {
  await db.runAsync(
    `INSERT INTO nutrition_goals (id, calorie_goal, protein_g, carbs_g, fat_g, water_ml, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(id) DO UPDATE SET
       calorie_goal=excluded.calorie_goal, protein_g=excluded.protein_g, carbs_g=excluded.carbs_g,
       fat_g=excluded.fat_g, water_ml=excluded.water_ml, updated_at=CURRENT_TIMESTAMP`,
    g.calorie_goal ?? null, g.protein_g ?? null, g.carbs_g ?? null, g.fat_g ?? null, g.water_ml ?? null,
  );
}

// ── Food log ──────────────────────────────────────────────────────────────────
export interface NewFoodLog {
  dateKey?: string; mealType?: string | null; name: string; qty?: number | null; unit?: string | null;
  calories?: number | null; protein_g?: number | null; carbs_g?: number | null; fat_g?: number | null;
  fiber_g?: number | null; sugar_g?: number | null; sodium_mg?: number | null;
  source?: string | null; confidence?: string | null; photo_uri?: string | null;
}

export async function insertFoodLog(db: SQLiteDatabase, f: NewFoodLog): Promise<number> {
  const r = await db.runAsync(
    `INSERT INTO food_log (date_key, meal_type, name, qty, unit, calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g, sodium_mg, source, confidence, photo_uri)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    f.dateKey ?? todayKey(), f.mealType ?? null, f.name, f.qty ?? null, f.unit ?? null,
    f.calories ?? null, f.protein_g ?? null, f.carbs_g ?? null, f.fat_g ?? null,
    f.fiber_g ?? null, f.sugar_g ?? null, f.sodium_mg ?? null,
    f.source ?? 'text', f.confidence ?? null, f.photo_uri ?? null,
  );
  return r.lastInsertRowId;
}

export async function listFoodLog(db: SQLiteDatabase, dateKey = todayKey()): Promise<FoodLogRow[]> {
  return db.getAllAsync<FoodLogRow>(
    'SELECT * FROM food_log WHERE date_key = ? ORDER BY created_at ASC, id ASC', dateKey,
  );
}

export async function deleteFoodLog(db: SQLiteDatabase, id: number): Promise<boolean> {
  const r = await db.runAsync('DELETE FROM food_log WHERE id = ?', id);
  return r.changes > 0;
}

/** The user's most-logged foods over the last few weeks — powers the one-tap "quick add" chips so
 *  repetitive Indian meals re-log instantly. Returns display names, most frequent + recent first. */
export async function getFrequentFoods(db: SQLiteDatabase, limit = 6): Promise<string[]> {
  const rows = await db.getAllAsync<{ name: string }>(
    `SELECT name FROM food_log
     WHERE date_key >= date('now', '-21 days') AND name IS NOT NULL AND TRIM(name) != ''
     GROUP BY LOWER(name) ORDER BY COUNT(*) DESC, MAX(created_at) DESC LIMIT ?`,
    limit,
  );
  return rows.map((r) => r.name);
}

/** Per-day calorie+macro totals for the last N days (for trends / net-calorie rolling avg).
 *  `meals` = distinct meal slots logged that day — lets callers tell a complete day from a single snack
 *  (so a partially-logged day isn't mistaken for a real, steep calorie deficit). */
export async function dailyIntakeTotals(db: SQLiteDatabase, days = 7): Promise<Array<{ date_key: string; calories: number; protein_g: number; carbs_g: number; fat_g: number; meals: number }>> {
  return db.getAllAsync(
    `SELECT date_key,
       ROUND(SUM(COALESCE(calories,0)))  AS calories,
       ROUND(SUM(COALESCE(protein_g,0))) AS protein_g,
       ROUND(SUM(COALESCE(carbs_g,0)))   AS carbs_g,
       ROUND(SUM(COALESCE(fat_g,0)))     AS fat_g,
       COUNT(DISTINCT NULLIF(TRIM(COALESCE(meal_type,'')),'')) AS meals
     FROM food_log
     WHERE date_key >= date('now', ?)
     GROUP BY date_key ORDER BY date_key DESC`,
    `-${days} days`,
  );
}
