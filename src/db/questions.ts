import type { SQLiteDatabase } from 'expo-sqlite';

export async function insertQuestionSignal(
  db: SQLiteDatabase,
  question: string,
  intent: string,
  answerSummary: string,
  organizationHint: string,
): Promise<void> {
  await db.runAsync(
    'INSERT INTO questions (question, intent, answer_summary, organization_hint) VALUES (?, ?, ?, ?)',
    question,
    intent,
    answerSummary,
    organizationHint,
  );
}

export interface QuestionIntentSummary {
  intent: string;
  count: number;
  last_asked_at: string;
}

export async function listRecognizedQuestionIntentSummaries(db: SQLiteDatabase): Promise<QuestionIntentSummary[]> {
  return db.getAllAsync<QuestionIntentSummary>(
    `SELECT intent, COUNT(*) AS count, MAX(created_at) AS last_asked_at
     FROM questions WHERE intent <> 'unclassified'
     GROUP BY intent ORDER BY count DESC, last_asked_at DESC`,
  );
}
