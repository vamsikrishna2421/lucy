/**
 * Medications (Dr. Lucy) — track what the user/their doctor set: name, dosage, and dose times.
 * Purely a tracker + reminder: LUCY never recommends a drug, dose, or interaction — it only reminds
 * the user to take what they entered and records adherence. Med-interaction/medical advice is out of
 * scope (liability) per docs + the health-guardian guardrails.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

export interface MedicationRow {
  id: number;
  name: string;
  dosage: string | null;
  times: string | null; // JSON array of "HH:MM" strings
  notes: string | null;
  active: number;
  created_at: string;
}

export function parseTimes(times: string | null): string[] {
  if (!times) return [];
  try { const a = JSON.parse(times); return Array.isArray(a) ? a.filter((t) => typeof t === 'string') : []; } catch { return []; }
}

export async function listMedications(db: SQLiteDatabase): Promise<MedicationRow[]> {
  return db.getAllAsync<MedicationRow>("SELECT * FROM medications WHERE active = 1 ORDER BY created_at DESC");
}

export async function addMedication(db: SQLiteDatabase, name: string, dosage: string | null, times: string[], notes: string | null): Promise<number> {
  const res = await db.runAsync(
    'INSERT INTO medications (name, dosage, times, notes) VALUES (?, ?, ?, ?)',
    name.trim(), (dosage ?? '').trim() || null, JSON.stringify(times.filter(Boolean)), (notes ?? '').trim() || null,
  );
  return res.lastInsertRowId;
}

export async function deactivateMedication(db: SQLiteDatabase, id: number): Promise<boolean> {
  const res = await db.runAsync("UPDATE medications SET active = 0 WHERE id = ?", id);
  return res.changes > 0;
}

/** Record a dose as taken (idempotent per med+date+time so double-taps don't double-log). */
export async function logMedicationTaken(db: SQLiteDatabase, medicationId: number, dateKey: string, timeLabel: string): Promise<void> {
  const existing = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM medication_log WHERE medication_id = ? AND date_key = ? AND time_label = ?',
    medicationId, dateKey, timeLabel,
  );
  if (existing) return;
  await db.runAsync('INSERT INTO medication_log (medication_id, date_key, time_label) VALUES (?, ?, ?)', medicationId, dateKey, timeLabel);
}

/** Which dose times have been logged as taken for a med today (so the UI can check them off). */
export async function takenTimesToday(db: SQLiteDatabase, medicationId: number, dateKey: string): Promise<string[]> {
  const rows = await db.getAllAsync<{ time_label: string }>(
    'SELECT time_label FROM medication_log WHERE medication_id = ? AND date_key = ?', medicationId, dateKey,
  );
  return rows.map((r) => r.time_label);
}
