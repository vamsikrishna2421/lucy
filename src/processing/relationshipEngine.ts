import type { SQLiteDatabase } from 'expo-sqlite';

export interface PersonContext {
  name: string;
  lastMentioned: string | null;
  mentionCount: number;
  typicalContext: string | null;
  pendingFollowUps: number;
}

export async function updatePersonContext(
  db: SQLiteDatabase,
  personName: string,
  captureText: string,
): Promise<void> {
  const existing = await db.getFirstAsync<PersonContext>(
    'SELECT * FROM person_contexts WHERE name = ?',
    personName,
  );

  // Build a short context summary from the capture text (first 120 chars)
  const contextSnippet = captureText.slice(0, 120).replace(/\n/g, ' ');

  if (existing) {
    // Append new context snippet to existing, keep last 2 contexts
    const contexts = (existing.typicalContext ?? '').split(' | ').filter(Boolean);
    contexts.push(contextSnippet);
    const combined = contexts.slice(-2).join(' | ');
    await db.runAsync(
      `UPDATE person_contexts
       SET last_mentioned = CURRENT_TIMESTAMP,
           mention_count = mention_count + 1,
           typical_context = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE name = ?`,
      combined,
      personName,
    );
  } else {
    await db.runAsync(
      `INSERT INTO person_contexts (name, last_mentioned, mention_count, typical_context)
       VALUES (?, CURRENT_TIMESTAMP, 1, ?)`,
      personName,
      contextSnippet,
    );
  }

  // Update pending follow-up count for this person
  const followUpCount = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) as n FROM follow_ups WHERE assignee = ? AND status = 'pending'`,
    personName,
  );
  await db.runAsync(
    'UPDATE person_contexts SET pending_followups = ? WHERE name = ?',
    followUpCount?.n ?? 0,
    personName,
  );
}

export async function getAllPersonContexts(db: SQLiteDatabase): Promise<PersonContext[]> {
  return db.getAllAsync<PersonContext>(
    `SELECT name, last_mentioned as lastMentioned, mention_count as mentionCount,
            typical_context as typicalContext, pending_followups as pendingFollowUps
     FROM person_contexts
     ORDER BY mention_count DESC, last_mentioned DESC`,
  );
}

export async function getPersonInsights(db: SQLiteDatabase): Promise<string[]> {
  const people = await getAllPersonContexts(db);
  const insights: string[] = [];
  const now = Date.now();

  for (const person of people) {
    if (!person.lastMentioned) continue;

    const lastDate = new Date(
      person.lastMentioned.includes('T') ? person.lastMentioned : `${person.lastMentioned.replace(' ', 'T')}Z`,
    );
    const daysSince = Math.floor((now - lastDate.getTime()) / (1000 * 60 * 60 * 24));

    if (person.pendingFollowUps > 0) {
      insights.push(
        `${person.name} has ${person.pendingFollowUps} pending follow-up${person.pendingFollowUps > 1 ? 's' : ''}.`,
      );
    } else if (daysSince >= 14 && person.mentionCount >= 3) {
      insights.push(`You haven't mentioned ${person.name} in ${daysSince} days.`);
    }
  }

  return insights.slice(0, 3);
}
