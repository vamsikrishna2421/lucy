import type { SQLiteDatabase } from 'expo-sqlite';
import type { ExtractedPlace, PrivacyLevel } from '../types/extraction';

export interface PlaceRow extends ExtractedPlace {
  id: number;
  created_at: string;
  privacy_level: PrivacyLevel;
  status: string;
}

export async function insertPlace(
  db: SQLiteDatabase,
  captureId: number,
  place: ExtractedPlace,
  privacy: PrivacyLevel,
): Promise<void> {
  await db.runAsync(
    'INSERT INTO places (capture_id, name, reason, urgency, privacy_level) VALUES (?, ?, ?, ?, ?)',
    captureId,
    place.name,
    place.reason,
    place.urgency,
    privacy,
  );
}

export async function listPlaces(db: SQLiteDatabase): Promise<PlaceRow[]> {
  return db.getAllAsync<PlaceRow>('SELECT * FROM places ORDER BY created_at DESC, id DESC');
}
