import type { SQLiteDatabase } from 'expo-sqlite';
import type { ExtractedExpense, PrivacyLevel } from '../types/extraction';

export interface ExpenseRow {
  id: number;
  created_at: string;
  amount: number | null;
  description: string;
  category: string;
  privacy_level: PrivacyLevel;
}

// Keyword → category rules so common payments don't all land in the LLM's "other" bucket.
const CATEGORY_RULES: Array<[RegExp, string]> = [
  [/\b(rent|lease|landlord)\b/i, 'housing'],
  [/\b(insurance|premium|policy)\b/i, 'insurance'],
  [/\b(debt|loan|repay|repaid|emi|mortgage|owed?)\b/i, 'debt'],
  [/\b(subscription|storage|cloud|snowflake|aws|azure|saas|hosting|domain|software|license)\b/i, 'bills'],
  [/\b(electricity|utility|utilities|internet|wifi|phone bill|gas bill|water bill)\b/i, 'utilities'],
  [/\b(grocery|groceries|supermarket|patel brothers)\b/i, 'groceries'],
  [/\b(restaurant|coffee|dunkin|starbucks|lunch|dinner|breakfast|food|cafe|meal)\b/i, 'food'],
  [/\b(uber|lyft|fuel|petrol|gas station|transit|flight|airfare|train|cab|taxi)\b/i, 'transport'],
  [/\b(doctor|medical|pharmacy|hospital|medicine|clinic|dental)\b/i, 'health'],
  [/\b(tax|taxes|irs)\b/i, 'tax'],
];
const GENERIC_CATS = new Set(['', 'other', 'others', 'misc', 'miscellaneous', 'general', 'uncategorized']);

/** Keep a specific LLM category; otherwise infer one from the description keywords. */
export function normalizeCategory(description: string, category: string | null | undefined): string {
  const cat = (category || '').trim().toLowerCase();
  if (cat && !GENERIC_CATS.has(cat)) return cat;
  const hay = `${description || ''} ${cat}`;
  for (const [re, c] of CATEGORY_RULES) if (re.test(hay)) return c;
  return cat || 'other';
}

export async function insertExpense(
  db: SQLiteDatabase,
  captureId: number,
  expense: ExtractedExpense,
  privacy: PrivacyLevel,
): Promise<void> {
  const parsed = Number(expense.amount.replace(/[^0-9.-]/g, ''));
  await db.runAsync(
    'INSERT INTO expenses (capture_id, amount, description, category, privacy_level) VALUES (?, ?, ?, ?, ?)',
    captureId,
    Number.isFinite(parsed) ? parsed : null,
    expense.description,
    normalizeCategory(expense.description, expense.category),
    privacy,
  );
}

/** Re-categorizes existing expenses still sitting in a generic "other" bucket. Returns count fixed. */
export async function recategorizeExpenses(db: SQLiteDatabase): Promise<number> {
  const rows = await db.getAllAsync<ExpenseRow>('SELECT * FROM expenses');
  let fixed = 0;
  for (const r of rows) {
    const cat = (r.category || '').trim().toLowerCase();
    if (cat && !GENERIC_CATS.has(cat)) continue;
    const next = normalizeCategory(r.description, r.category);
    if (next !== cat) { await db.runAsync('UPDATE expenses SET category = ? WHERE id = ?', next, r.id); fixed++; }
  }
  return fixed;
}

export async function listExpenses(db: SQLiteDatabase): Promise<ExpenseRow[]> {
  return db.getAllAsync<ExpenseRow>('SELECT * FROM expenses ORDER BY created_at DESC, id DESC');
}

export async function deleteExpense(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM expenses WHERE id = ?', id);
}
