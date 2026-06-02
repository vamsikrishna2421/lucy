import type { SQLiteDatabase } from 'expo-sqlite';

export interface LocationSnapshot {
  id: number;
  recorded_at: string;
  hour_key: string;   // YYYY-MM-DD-HH — one row per hour
  date_key: string;   // YYYY-MM-DD — for grouping by day
  city: string | null;
  region: string | null;
  country: string | null;
  // Coordinates rounded to 2 decimal places ≈ 1.1 km (~1 mile precision).
  // Enough to detect travel between cities; not precise enough to locate a specific building.
  latitude: number | null;
  longitude: number | null;
}

export interface DayLocationSummary {
  date_key: string;
  cities: string[]; // distinct cities visited that day, in order
  firstCity: string | null;
}

export async function recordLocationSnapshot(
  db: SQLiteDatabase,
  city: string | null,
  region: string | null,
  country: string | null,
  lat: number | null,
  lon: number | null,
): Promise<void> {
  const now = new Date();
  const dateKey = now.toISOString().slice(0, 10);
  const hourKey = `${dateKey}-${String(now.getHours()).padStart(2, '0')}`;
  // ~1 mile precision: round to 2 decimal places (1 degree lat ≈ 111 km → 0.01° ≈ 1.1 km)
  const coarseLat = lat !== null ? Math.round(lat * 100) / 100 : null;
  const coarseLon = lon !== null ? Math.round(lon * 100) / 100 : null;
  await db.runAsync(
    `INSERT INTO location_snapshots (hour_key, date_key, city, region, country, latitude, longitude)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(hour_key) DO UPDATE SET
       city = excluded.city, region = excluded.region, country = excluded.country,
       latitude = excluded.latitude, longitude = excluded.longitude,
       recorded_at = CURRENT_TIMESTAMP`,
    hourKey, dateKey, city, region, country, coarseLat, coarseLon,
  );
}

/** Returns one row per day: distinct cities visited and the first city seen. */
export async function listLocationSnapshots(db: SQLiteDatabase, days = 7): Promise<DayLocationSummary[]> {
  const rows = await db.getAllAsync<{ date_key: string; city: string | null }>(
    `SELECT date_key, city FROM location_snapshots
     WHERE date_key >= date('now', ?)
     ORDER BY date_key DESC, recorded_at ASC`,
    `-${days} days`,
  );
  // Group into day summaries
  const byDay = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.city) continue;
    const existing = byDay.get(row.date_key) ?? [];
    if (!existing.includes(row.city)) existing.push(row.city);
    byDay.set(row.date_key, existing);
  }
  return [...byDay.entries()].map(([date_key, cities]) => ({
    date_key,
    cities,
    firstCity: cities[0] ?? null,
  }));
}
