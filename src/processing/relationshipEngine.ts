import type { SQLiteDatabase } from 'expo-sqlite';
import { daysSinceDb } from '../utils/datetime';

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

    const daysSince = daysSinceDb(person.lastMentioned, now);

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

// ─── Keep-warm nudges (Vamsi top-6 #3) ──────────────────────────────────────────────────────────
// People LUCY knows (mentioned enough to matter) who've gone quiet. Warm, human copy — never a
// dashboard metric — plus a one-tap "remind me to reach out" action.

export interface KeepWarmNudge {
  name: string;
  daysSince: number;
  message: string;     // warm, first-person companion voice
  action: string;      // the one-tap reminder label
}

function days(ago: number): string {
  if (ago >= 60) return `${Math.round(ago / 30)} months`;
  if (ago >= 14) return `${Math.round(ago / 7)} weeks`;
  return `${ago} days`;
}

/** Warm, human reach-out nudges for known people who've gone quiet. Cooler thresholds for the
 *  people the user talks about most (a close contact going 2 weeks quiet matters more). */
export async function getKeepWarmNudges(db: SQLiteDatabase): Promise<KeepWarmNudge[]> {
  const people = await getAllPersonContexts(db);
  const now = Date.now();
  const nudges: KeepWarmNudge[] = [];

  for (const p of people) {
    if (!p.lastMentioned || p.pendingFollowUps > 0) continue; // pending follow-ups are their own surface
    if (p.mentionCount < 3) continue; // only people who clearly matter to the user
    const ago = daysSinceDb(p.lastMentioned, now);
    // The more often they normally come up, the sooner "quiet" feels notable.
    const threshold = p.mentionCount >= 8 ? 14 : p.mentionCount >= 5 ? 21 : 30;
    if (ago < threshold) continue;

    const close = p.mentionCount >= 8;
    const message = close
      ? `You and ${p.name} usually talk more than this — it's been ${days(ago)}. Want me to remind you to reach out?`
      : `It's been ${days(ago)} since ${p.name} came up. Maybe send a quick hello?`;
    nudges.push({ name: p.name, daysSince: ago, message, action: `Remind me to message ${p.name}` });
  }

  // Most-overdue, most-important first; keep it to a calm few.
  return nudges.sort((a, b) => b.daysSince - a.daysSince).slice(0, 3);
}

/** One-tap action behind a keep-warm nudge: drop a gentle reminder to reach out to this person. */
export async function remindToMessage(db: SQLiteDatabase, name: string): Promise<void> {
  const [{ insertCapture }, { insertReminder }] = await Promise.all([
    import('../db/captures'),
    import('../db/reminders'),
  ]);
  const text = `Message ${name}`;
  // Tomorrow morning by default — a soft nudge, not an alarm.
  const when = new Date(Date.now() + 86_400_000);
  when.setHours(10, 0, 0, 0);
  const captureId = await insertCapture(db, 'text', `Keep in touch with ${name}`, 'normal');
  await db.runAsync('UPDATE captures SET processed = 1, processed_at = CURRENT_TIMESTAMP, next_attempt_at = NULL, extracted_title = ? WHERE id = ?', text, captureId);
  await insertReminder(db, captureId, { text, time: when.toISOString(), urgency: 'low' }, 'normal');
}
