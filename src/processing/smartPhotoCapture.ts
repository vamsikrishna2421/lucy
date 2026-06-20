/**
 * Smart photo capture — ONE tap, LUCY classifies the photo herself (no Meal/Receipt/Note menu).
 * A single vision call decides: meal (→ log calories), receipt (→ expense), or note/document (→ a
 * memory capture with the original image). Model-aware (Claude vision when a Claude model is selected,
 * else gpt-4o); never silently uses an OpenAI model against the user's choice.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

export interface SmartCaptureResult {
  type: 'meal' | 'receipt' | 'note' | 'unknown';
  message: string;
  kcal?: number;
  estimated?: boolean;
}

const CLASSIFY_PROMPT = `Look at this image and decide what the user is capturing. Return STRICT JSON only, no markdown:
{"type":"meal|receipt|note",
 "meal":{"items":[{"name":"","qty":<number|null>,"unit":"","calories":<kcal>,"protein_g":<g>,"carbs_g":<g>,"fat_g":<g>,"confidence":"high|medium|low"}]},
 "receipt":{"amount":"<number>","merchant":"","category":"food|transport|shopping|entertainment|other"},
 "note":{"text":"<verbatim text / concise description of the document or scene>"}}
Rules:
- "meal" = food or drink the person is eating/drinking. Estimate per-item calories+macros (Indian portions: katori, roti/chapati piece, idli/dosa, rice per katori). Numbers only.
- "receipt" = a purchase/payment receipt or bill.
- "note" = anything else to remember: a handwritten note, whiteboard, screen, document, page of text, or a general scene. Put the readable text (verbatim) or a short description in note.text.
Fill ONLY the object matching "type". Choose the single best type.`;

function parse(raw: string): { type: string; meal?: { items?: Array<Record<string, unknown>> }; receipt?: Record<string, unknown>; note?: { text?: string } } | null {
  const s = raw.indexOf('{'); const e = raw.lastIndexOf('}');
  if (s === -1 || e === -1) return null;
  try { return JSON.parse(raw.slice(s, e + 1)); } catch { return null; }
}

async function visionClassify(uri: string): Promise<string> {
  const { readAsStringAsync, EncodingType } = await import('expo-file-system/legacy');
  const base64 = await readAsStringAsync(uri, { encoding: EncodingType.Base64 });
  const { getModelKeyStatus } = await import('../ai/provider');
  const status = await getModelKeyStatus();
  const mediaType = /\.png$/i.test(uri) ? 'image/png' : 'image/jpeg';
  if (status.model.startsWith('claude-')) {
    const { promptClaudeVision } = await import('../ai/claude');
    return promptClaudeVision(CLASSIFY_PROMPT, base64, mediaType, status.model);
  }
  const { getRemoteOpenAIKey } = await import('../ai/remoteAccess');
  const key = await getRemoteOpenAIKey();
  if (!key) return '';
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o', max_tokens: 800,
      messages: [{ role: 'user', content: [
        { type: 'text', text: CLASSIFY_PROMPT },
        { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64}`, detail: 'high' } },
      ] }],
    }),
  });
  if (!res.ok) return '';
  const j = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  return j.choices?.[0]?.message?.content ?? '';
}

/** One-tap: classify the photo and route it. Returns what was done (for the toast/popup). */
export async function smartCapturePhoto(db: SQLiteDatabase, uri: string): Promise<SmartCaptureResult> {
  let raw = '';
  try { raw = await visionClassify(uri); } catch { /* handled below */ }
  const parsed = raw ? parse(raw) : null;
  const type = parsed?.type === 'meal' || parsed?.type === 'receipt' || parsed?.type === 'note' ? parsed.type : 'note';

  if (type === 'meal') {
    const items = (parsed?.meal?.items ?? []).filter((i) => i && i.name).map((i) => ({
      name: String(i.name), qty: typeof i.qty === 'number' ? i.qty : null, unit: i.unit ? String(i.unit) : null,
      calories: typeof i.calories === 'number' ? Math.round(i.calories) : null,
      protein_g: typeof i.protein_g === 'number' ? Math.round(i.protein_g) : null,
      carbs_g: typeof i.carbs_g === 'number' ? Math.round(i.carbs_g) : null,
      fat_g: typeof i.fat_g === 'number' ? Math.round(i.fat_g) : null,
      confidence: (['high', 'medium', 'low'] as const).includes(i.confidence as 'high') ? (i.confidence as 'high') : 'low',
    }));
    const { insertFoodLog, todayKey } = await import('../db/healthNutrition');
    const meal = inferMealType();
    if (!items.length) {
      await insertFoodLog(db, { dateKey: todayKey(), mealType: meal, name: 'Meal (from photo)', qty: null, unit: null, calories: null, protein_g: null, carbs_g: null, fat_g: null, source: 'photo', confidence: 'low', photo_uri: uri });
      return { type: 'meal', estimated: false, message: 'Logged your meal — I couldn’t read the calories from that shot. A clearer, top-down photo helps.' };
    }
    for (const it of items) await insertFoodLog(db, { dateKey: todayKey(), mealType: meal, name: it.name, qty: it.qty, unit: it.unit, calories: it.calories, protein_g: it.protein_g, carbs_g: it.carbs_g, fat_g: it.fat_g, source: 'photo', confidence: it.confidence, photo_uri: uri });
    const kcal = items.reduce((s, i) => s + (i.calories ?? 0), 0);
    return { type: 'meal', estimated: true, kcal, message: `Logged ${items.length} item${items.length === 1 ? '' : 's'} — about ${kcal} calories.` };
  }

  if (type === 'receipt') {
    const r = parsed?.receipt ?? {};
    const parts: string[] = [];
    if (r.merchant) parts.push(`Paid at ${r.merchant}`);
    if (r.amount) parts.push(`amount ${r.amount}`);
    if (r.category) parts.push(`category ${r.category}`);
    const text = parts.length ? parts.join(', ') : 'Receipt scanned';
    const { enqueueTranscript, processQueue } = await import('./extract');
    const capId = await enqueueTranscript(text, 'text'); void processQueue();
    // Keep the receipt photo — reachable from the expense via its capture.
    try {
      const stored = await persistOriginalImage(uri);
      if (stored) { const { setCaptureSourceImage } = await import('../db/captures'); await setCaptureSourceImage(db, capId, stored); }
    } catch { /* image link optional */ }
    return { type: 'receipt', message: `Logged a receipt${r.amount ? ` for ${r.amount}` : ''}.` };
  }

  // note / document → a memory capture with the original image attached.
  const text = (parsed?.note?.text ?? '').trim() || 'Captured an image.';
  const { enqueueTranscript } = await import('./extract');
  const capId = await enqueueTranscript(text, 'text');
  try {
    const stored = await persistOriginalImage(uri);
    if (stored) { const { setCaptureSourceImage } = await import('../db/captures'); await setCaptureSourceImage(db, capId, stored); }
  } catch { /* image link optional */ }
  return { type: 'note', message: 'Saved that to your memory — organizing it now.' };
}

function inferMealType(d = new Date()): string {
  const h = d.getHours();
  if (h < 11) return 'breakfast';
  if (h < 16) return 'lunch';
  if (h < 21) return 'dinner';
  return 'snack';
}

export async function persistOriginalImage(uri: string): Promise<string | null> {
  try {
    const { documentDirectory, makeDirectoryAsync, copyAsync, getInfoAsync } = await import('expo-file-system/legacy');
    const dir = `${documentDirectory}lens_images/`;
    const info = await getInfoAsync(dir);
    if (!info.exists) await makeDirectoryAsync(dir, { intermediates: true });
    const ext = /\.png$/i.test(uri) ? 'png' : 'jpg';
    const dest = `${dir}snap_${Date.now()}.${ext}`;
    await copyAsync({ from: uri, to: dest });
    return dest;
  } catch { return null; }
}
