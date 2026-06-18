/**
 * Food → nutrition estimation (calorie INTAKE logging).
 *
 * Text/voice: describe a meal ("2 rotis and a katori of dal") → LLM estimates per-item calories+macros.
 * Photo: reuse the remote-vision path (same as Lucy Lens) → recognise foods + estimate macros.
 * Indian-food + home-portion aware (katori, roti/chapati piece, idli, dosa) per docs/INDIA_HEALTH_RESEARCH.
 * All estimates are labelled with confidence — this is guidance, not a clinical measurement.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import { insertFoodLog, type NewFoodLog } from '../db/healthNutrition';

export interface EstimatedFoodItem {
  name: string; qty: number | null; unit: string | null;
  calories: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null;
  confidence: 'high' | 'medium' | 'low';
}

const NUTRITION_SYS = `You are LUCY's nutrition estimator. Given a meal (text or image), list each food with a realistic calorie + macro estimate. Be especially accurate for INDIAN foods and home portions — katori (small bowl), roti/chapati (per piece), idli/dosa/vada (per piece), rice (per katori/cup), dal/sabzi (per katori). Estimate for the stated quantity; if unspecified assume ONE typical serving.
Return STRICT JSON only, no markdown:
{"items":[{"name":"...","qty":<number>,"unit":"...","calories":<kcal>,"protein_g":<g>,"carbs_g":<g>,"fat_g":<g>,"confidence":"high|medium|low"}]}
Rules: numbers only (no ranges/units inside numbers); kcal + grams; never invent foods not described/visible; if truly unclear return {"items":[]}.`;

function parseItems(raw: string): EstimatedFoodItem[] {
  const start = raw.indexOf('{'); const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) return [];
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { items?: Array<Partial<EstimatedFoodItem>> };
    return (parsed.items ?? [])
      .filter((i) => i && i.name)
      .map((i) => ({
        name: String(i.name),
        qty: typeof i.qty === 'number' ? i.qty : null,
        unit: i.unit ? String(i.unit) : null,
        calories: typeof i.calories === 'number' ? Math.round(i.calories) : null,
        protein_g: typeof i.protein_g === 'number' ? Math.round(i.protein_g) : null,
        carbs_g: typeof i.carbs_g === 'number' ? Math.round(i.carbs_g) : null,
        fat_g: typeof i.fat_g === 'number' ? Math.round(i.fat_g) : null,
        confidence: (['high', 'medium', 'low'] as const).includes(i.confidence as 'high') ? (i.confidence as 'high') : 'low',
      }));
  } catch { return []; }
}

/** Estimate nutrition for a free-text meal description. Returns [] when no remote AI or nothing parseable. */
export async function estimateNutritionFromText(text: string): Promise<EstimatedFoodItem[]> {
  const meal = (text || '').trim();
  if (!meal) return [];
  try {
    const { resolveRemoteAvailability } = await import('../ai/provider');
    const { available, openAIKey } = await resolveRemoteAvailability();
    if (!available) return [];
    const { promptAI } = await import('../ai/openai');
    const raw = await promptAI(NUTRITION_SYS, `Meal: ${meal}`, openAIKey);
    return parseItems(raw);
  } catch { return []; }
}

/** Estimate nutrition from a food photo (remote vision; Claude Sonnet preferred, else gpt-4o high-detail). */
export async function estimateNutritionFromPhoto(uri: string): Promise<EstimatedFoodItem[]> {
  try {
    const { readAsStringAsync, EncodingType } = await import('expo-file-system/legacy');
    const base64 = await readAsStringAsync(uri, { encoding: EncodingType.Base64 });
    const { resolveRemoteAvailability } = await import('../ai/provider');
    const { available, openAIKey } = await resolveRemoteAvailability();
    if (!available) return [];
    const preferred = (await import('../ai/modelPreference')).getPreferredModel(require('../config').config.openAIModel);
    const mediaType = /\.png$/i.test(uri) ? 'image/png' : 'image/jpeg';
    let content = '';
    if (preferred.startsWith('claude-')) {
      const { promptClaudeVision } = await import('../ai/claude');
      content = await promptClaudeVision(`${NUTRITION_SYS}\n\nIdentify every food in the photo and estimate portions.`, base64, mediaType);
    } else if (openAIKey) {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${openAIKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o', max_tokens: 700,
          messages: [{ role: 'user', content: [
            { type: 'text', text: `${NUTRITION_SYS}\n\nIdentify every food in the photo and estimate portions.` },
            { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64}`, detail: 'high' } },
          ] }],
        }),
      });
      if (res.ok) { const j = await res.json() as { choices?: Array<{ message?: { content?: string } }> }; content = j.choices?.[0]?.message?.content ?? ''; }
    }
    return parseItems(content);
  } catch { return []; }
}

export interface FoodLogResult {
  logged: number;
  items: EstimatedFoodItem[];
  /** True when we recorded the meal but couldn't estimate calories — caller should offer to refine. */
  estimated: boolean;
}

/** A short, clean meal label for a placeholder row when estimation fails (no AI / too vague). */
function mealLabel(text: string): string {
  const t = (text || '').trim().replace(/\s+/g, ' ');
  return (t.length > 60 ? `${t.slice(0, 57)}…` : t) || 'Meal';
}

/** Estimate + persist a text/voice meal into food_log. mealType inferred from time if not given.
 *  Never drops the meal: if estimation is empty (vague description or no remote AI), a placeholder
 *  row is logged with unknown calories so the meal still appears and totals stay honest. */
export async function logFoodFromText(db: SQLiteDatabase, text: string, mealType?: string | null, dateKey?: string): Promise<FoodLogResult> {
  const items = await estimateNutritionFromText(text);
  const meal = mealType ?? inferMealType();
  for (const it of items) {
    const row: NewFoodLog = {
      dateKey, mealType: meal, name: it.name, qty: it.qty, unit: it.unit,
      calories: it.calories, protein_g: it.protein_g, carbs_g: it.carbs_g, fat_g: it.fat_g,
      source: 'text', confidence: it.confidence,
    };
    await insertFoodLog(db, row);
  }
  if (items.length === 0 && (text || '').trim()) {
    await insertFoodLog(db, {
      dateKey, mealType: meal, name: mealLabel(text), qty: null, unit: null,
      calories: null, protein_g: null, carbs_g: null, fat_g: null, source: 'text', confidence: 'low',
    });
    return { logged: 1, items, estimated: false };
  }
  return { logged: items.length, items, estimated: items.length > 0 };
}

/** Estimate + persist a photographed meal. Logs a placeholder if the photo can't be estimated. */
export async function logFoodFromPhoto(db: SQLiteDatabase, uri: string, mealType?: string | null): Promise<FoodLogResult> {
  const items = await estimateNutritionFromPhoto(uri);
  const meal = mealType ?? inferMealType();
  for (const it of items) {
    await insertFoodLog(db, {
      mealType: meal, name: it.name, qty: it.qty, unit: it.unit,
      calories: it.calories, protein_g: it.protein_g, carbs_g: it.carbs_g, fat_g: it.fat_g,
      source: 'photo', confidence: it.confidence,
    });
  }
  if (items.length === 0) {
    await insertFoodLog(db, {
      mealType: meal, name: 'Meal (from photo)', qty: null, unit: null,
      calories: null, protein_g: null, carbs_g: null, fat_g: null, source: 'photo', confidence: 'low',
    });
    return { logged: 1, items, estimated: false };
  }
  return { logged: items.length, items, estimated: true };
}

function inferMealType(d = new Date()): string {
  const h = d.getHours();
  if (h < 11) return 'breakfast';
  if (h < 16) return 'lunch';
  if (h < 21) return 'dinner';
  return 'snack';
}
