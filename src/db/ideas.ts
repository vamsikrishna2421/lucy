import type { SQLiteDatabase } from 'expo-sqlite';
import type { ExtractedIdea, PrivacyLevel } from '../types/extraction';

export interface IdeaRow extends ExtractedIdea {
  id: number;
  created_at: string;
  privacy_level: PrivacyLevel;
}

export async function insertIdea(
  db: SQLiteDatabase,
  captureId: number,
  idea: ExtractedIdea,
): Promise<void> {
  await db.runAsync(
    'INSERT INTO ideas (capture_id, title, description, type, privacy_level) VALUES (?, ?, ?, ?, ?)',
    captureId,
    idea.title,
    idea.description,
    idea.type,
    'private',
  );
}

export async function listIdeas(db: SQLiteDatabase): Promise<IdeaRow[]> {
  return db.getAllAsync<IdeaRow>('SELECT * FROM ideas ORDER BY created_at DESC, id DESC');
}

export async function deleteIdea(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM ideas WHERE id = ?', id);
}
