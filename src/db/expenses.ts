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
    expense.category,
    privacy,
  );
}

export async function listExpenses(db: SQLiteDatabase): Promise<ExpenseRow[]> {
  return db.getAllAsync<ExpenseRow>('SELECT * FROM expenses ORDER BY created_at DESC, id DESC');
}

export async function deleteExpense(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM expenses WHERE id = ?', id);
}
