import type { SQLiteDatabase } from 'expo-sqlite';

export interface BatterySnapshot {
  id: number;
  recorded_at: string;
  battery_level: number;
  is_charging: number;
  hour_of_day: number;
  day_of_week: number;
  captures_since_last: number;
}

export async function initDeviceStatsTable(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS battery_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      battery_level REAL NOT NULL,
      is_charging INTEGER DEFAULT 0,
      hour_of_day INTEGER NOT NULL,
      day_of_week INTEGER NOT NULL,
      captures_since_last INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_battery_recorded ON battery_snapshots(recorded_at);
  `);
}

export async function recordBatterySnapshot(
  db: SQLiteDatabase,
  batteryLevel: number,
  isCharging: boolean,
  capturesSinceLast: number,
): Promise<void> {
  const now = new Date();
  await db.runAsync(
    `INSERT INTO battery_snapshots (battery_level, is_charging, hour_of_day, day_of_week, captures_since_last)
     VALUES (?, ?, ?, ?, ?)`,
    Math.round(batteryLevel * 100),
    isCharging ? 1 : 0,
    now.getHours(),
    now.getDay(), // 0=Sun, 1=Mon ... 6=Sat
    capturesSinceLast,
  );
}

export async function getBatteryHistory(
  db: SQLiteDatabase,
  days = 7,
): Promise<BatterySnapshot[]> {
  return db.getAllAsync<BatterySnapshot>(
    `SELECT * FROM battery_snapshots
     WHERE recorded_at > datetime('now', ?)
     ORDER BY recorded_at DESC`,
    `-${days} days`,
  );
}

export async function getCapturePatterns(db: SQLiteDatabase): Promise<{
  byHour: Array<{ hour: number; count: number }>;
  byDayOfWeek: Array<{ day: number; count: number; dayName: string }>;
  topHour: number;
  topDay: string;
  avgPerDay: number;
  totalLast7Days: number;
}> {
  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  const [byHour, byDay, total] = await Promise.all([
    db.getAllAsync<{ hour: number; count: number }>(
      `SELECT strftime('%H', created_at) * 1 as hour, COUNT(*) as count
       FROM captures
       WHERE created_at > datetime('now', '-7 days')
       GROUP BY hour ORDER BY hour`,
    ),
    db.getAllAsync<{ day: number; count: number }>(
      `SELECT strftime('%w', created_at) * 1 as day, COUNT(*) as count
       FROM captures
       WHERE created_at > datetime('now', '-7 days')
       GROUP BY day ORDER BY day`,
    ),
    db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) as n FROM captures WHERE created_at > datetime('now', '-7 days')`,
    ),
  ]);

  const topHourRow = [...byHour].sort((a, b) => b.count - a.count)[0];
  const topDayRow  = [...byDay].sort((a, b) => b.count - a.count)[0];

  return {
    byHour,
    byDayOfWeek: byDay.map((d) => ({ ...d, dayName: DAY_NAMES[d.day] ?? 'Unknown' })),
    topHour: topHourRow?.hour ?? 9,
    topDay:  topDayRow ? (DAY_NAMES[topDayRow.day] ?? 'Unknown') : 'Monday',
    avgPerDay: Math.round((total?.n ?? 0) / 7),
    totalLast7Days: total?.n ?? 0,
  };
}
