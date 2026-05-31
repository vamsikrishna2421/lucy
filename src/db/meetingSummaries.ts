import type { SQLiteDatabase } from 'expo-sqlite';

export interface MeetingSummaryRow {
  id: number;
  title: string;
  recorded_at: string;
  duration_minutes: number;
  headline: string | null;
  key_decisions: string | null;   // JSON array
  action_items: string | null;    // JSON array
  open_questions: string | null;  // JSON array
  next_steps: string | null;
  attendees: string | null;       // JSON array
  raw_transcript: string | null;
}

export async function insertMeetingSummary(
  db: SQLiteDatabase,
  title: string,
  durationMinutes: number,
  headline: string | null,
  keyDecisions: string[],
  actionItems: Array<{ task: string; owner?: string; deadline?: string }>,
  openQuestions: string[],
  nextSteps: string | null,
  attendees: string[],
  rawTranscript: string | null,
): Promise<number> {
  const result = await db.runAsync(
    `INSERT INTO meeting_summaries
       (title, duration_minutes, headline, key_decisions, action_items, open_questions, next_steps, attendees, raw_transcript)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    title,
    durationMinutes,
    headline,
    JSON.stringify(keyDecisions),
    JSON.stringify(actionItems),
    JSON.stringify(openQuestions),
    nextSteps,
    JSON.stringify(attendees),
    rawTranscript,
  );
  return result.lastInsertRowId;
}

export async function listMeetingSummaries(db: SQLiteDatabase, limit = 50): Promise<MeetingSummaryRow[]> {
  return db.getAllAsync<MeetingSummaryRow>(
    'SELECT * FROM meeting_summaries ORDER BY recorded_at DESC, id DESC LIMIT ?',
    limit,
  );
}

export async function deleteMeetingSummary(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM meeting_summaries WHERE id = ?', id);
}
