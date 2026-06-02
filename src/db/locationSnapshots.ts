import type { SQLiteDatabase } from 'expo-sqlite';

export interface LocationSnapshot {
  id: number;
  recorded_at: string;
  date_key: string;     // YYYY-MM-DD — one snapshot per day per city
  city: string | null;
  region: string | null;
  country: string | null;
  // Coordinates coarsened to 2 decimal places (~11 km grid) — enough for
  // city-level travel insight, not precise enough to be a privacy concern.
  latitude: number | null;
  longitude: number | null;
}

export async function recordLocationSnapshot(
  db: SQLiteDatabase,
  city: string | null,
  region: string | null,
  country: string | null,
  lat: number | null,
  lon: number | null,
): Promise<void> {
  const dateKey = new Date().toISOString().slice(0, 10);
  const coarseLat = lat !== null ? Math.round(lat * 100) / 100 : null;
  const coarseLon = lon !== null ? Math.round(lon * 100) / 100 : null;
  // Upsert: if we already have an entry for today, update it (might have moved to a new city)
  await db.runAsync(
    `INSERT INTO location_snapshots (date_key, city, region, country, latitude, longitude)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(date_key) DO UPDATE SET
       city = excluded.city, region = excluded.region, country = excluded.country,
       latitude = excluded.latitude, longitude = excluded.longitude,
       recorded_at = CURRENT_TIMESTAMP`,
    dateKey, city, region, country, coarseLat, coarseLon,
  );
}

export async function listLocationSnapshots(db: SQLiteDatabase, days = 7): Promise<LocationSnapshot[]> {
  return db.getAllAsync<LocationSnapshot>(
    `SELECT * FROM location_snapshots
     WHERE recorded_at >= datetime('now', ?)
     ORDER BY date_key DESC`,
    `-${days} days`,
  );
}
