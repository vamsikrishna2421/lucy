import type { SQLiteDatabase } from 'expo-sqlite';
import type { ExtractedInterest } from '../types/extraction';

export interface InterestRow extends ExtractedInterest {
  id: number;
  updated_at: string;
  mention_count: number;
}

export async function upsertInterest(db: SQLiteDatabase, interest: ExtractedInterest): Promise<void> {
  await db.runAsync(
    `INSERT INTO interests (topic, strength, evidence) VALUES (?, ?, ?)
     ON CONFLICT(topic) DO UPDATE SET
       updated_at = CURRENT_TIMESTAMP,
       strength = excluded.strength,
       evidence = excluded.evidence,
       mention_count = interests.mention_count + 1`,
    interest.topic,
    interest.strength,
    interest.evidence,
  );
}

export async function listInterests(db: SQLiteDatabase): Promise<InterestRow[]> {
  return db.getAllAsync<InterestRow>(
    'SELECT * FROM interests ORDER BY mention_count DESC, updated_at DESC',
  );
}
