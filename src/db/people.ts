import type { SQLiteDatabase } from 'expo-sqlite';

export async function upsertPerson(db: SQLiteDatabase, name: string, context: string): Promise<void> {
  await db.runAsync(
    `INSERT INTO people (name, last_mentioned, context) VALUES (?, CURRENT_TIMESTAMP, ?)
     ON CONFLICT(name) DO UPDATE SET last_mentioned = CURRENT_TIMESTAMP, context = excluded.context`,
    name,
    context,
  );
}
