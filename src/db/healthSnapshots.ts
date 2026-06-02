import type { SQLiteDatabase } from 'expo-sqlite';

export interface HealthSnapshot {
  id: number;
  recorded_at: string;
  date_key: string;       // YYYY-MM-DD
  steps: number;
  sleep_hours: number | null;
  resting_hr: number | null;
  active_minutes: number | null;
}

export async function upsertHealthSnapshot(
  db: SQLiteDatabase,
  dateKey: string,
  steps: number,
  sleepHours: number | null,
  restingHr: number | null,
  activeMinutes: number | null,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO health_snapshots (date_key, steps, sleep_hours, resting_hr, active_minutes)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(date_key) DO UPDATE SET
       steps = excluded.steps,
       sleep_hours = COALESCE(excluded.sleep_hours, health_snapshots.sleep_hours),
       resting_hr  = COALESCE(excluded.resting_hr,  health_snapshots.resting_hr),
       active_minutes = COALESCE(excluded.active_minutes, health_snapshots.active_minutes),
       recorded_at = CURRENT_TIMESTAMP`,
    dateKey, steps, sleepHours, restingHr, activeMinutes,
  );
}

export async function listHealthSnapshots(db: SQLiteDatabase, days = 7): Promise<HealthSnapshot[]> {
  return db.getAllAsync<HealthSnapshot>(
    `SELECT * FROM health_snapshots
     WHERE date_key >= date('now', ?)
     ORDER BY date_key DESC`,
    `-${days} days`,
  );
}

export async function getTodayHealthSnapshot(db: SQLiteDatabase): Promise<HealthSnapshot | null> {
  return db.getFirstAsync<HealthSnapshot>(
    `SELECT * FROM health_snapshots WHERE date_key = date('now')`,
  );
}
