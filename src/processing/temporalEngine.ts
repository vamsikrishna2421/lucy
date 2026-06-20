import type { SQLiteDatabase } from 'expo-sqlite';
import type { TodoRow } from '../db/todos';
import type { OpenLoopRow } from '../db/openLoops';
import { daysSinceDb } from '../utils/datetime';

export interface UrgentItem {
  type: 'task' | 'loop' | 'followup';
  text: string;
  ageDays: number;
  urgencyScore: number; // 0–10
  id: number;
}

export interface RelationshipGap {
  personName: string;
  daysSinceMentioned: number;
  pendingFollowUps: number;
}

function ageInDays(dateStr: string): number {
  return daysSinceDb(dateStr);
}

export function scoreUrgency(urgency: string, ageDays: number): number {
  const base = urgency === 'high' ? 7 : urgency === 'medium' ? 4 : 2;
  // Escalate by 1 point per 3 days overdue, capped at 10
  const ageBoost = Math.floor(ageDays / 3);
  return Math.min(10, base + ageBoost);
}

export async function getOverdueItems(db: SQLiteDatabase): Promise<UrgentItem[]> {
  const [tasks, loops, followUps] = await Promise.all([
    db.getAllAsync<TodoRow & { created_at: string }>(
      "SELECT * FROM todos WHERE status = 'pending' ORDER BY created_at ASC",
    ),
    db.getAllAsync<OpenLoopRow>(
      "SELECT * FROM open_loops WHERE status = 'open' ORDER BY created_at ASC",
    ),
    db.getAllAsync<{ id: number; action: string; created_at: string; assignee: string }>(
      "SELECT * FROM follow_ups WHERE status = 'pending' ORDER BY created_at ASC",
    ),
  ]);

  const items: UrgentItem[] = [];

  for (const task of tasks) {
    const ageDays = ageInDays(task.created_at);
    if (ageDays >= 1) { // Only show tasks older than 1 day
      items.push({
        type: 'task',
        text: task.task,
        ageDays,
        urgencyScore: scoreUrgency(task.urgency, ageDays),
        id: task.id,
      });
    }
  }

  for (const loop of loops) {
    const ageDays = ageInDays(loop.created_at);
    if (ageDays >= 3) { // Loops surface after 3 days
      items.push({
        type: 'loop',
        text: loop.description,
        ageDays,
        urgencyScore: scoreUrgency('medium', ageDays),
        id: loop.id,
      });
    }
  }

  for (const fu of followUps) {
    const ageDays = ageInDays(fu.created_at);
    if (ageDays >= 2) { // Follow-ups surface after 2 days
      const text = fu.assignee ? `${fu.assignee}: ${fu.action}` : fu.action;
      items.push({
        type: 'followup',
        text,
        ageDays,
        urgencyScore: scoreUrgency('high', ageDays),
        id: fu.id,
      });
    }
  }

  return items.sort((a, b) => b.urgencyScore - a.urgencyScore);
}

export async function getRelationshipGaps(db: SQLiteDatabase): Promise<RelationshipGap[]> {
  const people = await db.getAllAsync<{
    name: string;
    last_mentioned: string | null;
    pending_followups: number;
  }>(
    `SELECT p.name,
            pc.last_mentioned,
            COUNT(CASE WHEN fu.status = 'pending' THEN 1 END) as pending_followups
     FROM people p
     LEFT JOIN person_contexts pc ON pc.name = p.name
     LEFT JOIN follow_ups fu ON fu.assignee = p.name
     GROUP BY p.name
     HAVING last_mentioned IS NOT NULL`,
  );

  const gaps: RelationshipGap[] = [];
  for (const person of people) {
    if (!person.last_mentioned) continue;
    const daysSince = ageInDays(person.last_mentioned);
    if (daysSince >= 14 || person.pending_followups > 0) {
      gaps.push({
        personName: person.name,
        daysSinceMentioned: daysSince,
        pendingFollowUps: person.pending_followups,
      });
    }
  }
  return gaps.sort((a, b) => b.pendingFollowUps - a.pendingFollowUps || b.daysSinceMentioned - a.daysSinceMentioned);
}

export async function getMoodTrend(db: SQLiteDatabase, days = 7): Promise<{
  dominant: string;
  positiveRatio: number;
  recentTones: string[];
}> {
  const entries = await db.getAllAsync<{ tone: string; created_at: string }>(
    `SELECT tone, created_at FROM mood_entries
     WHERE created_at > datetime('now', ?)
     ORDER BY created_at DESC`,
    `-${days} days`,
  );

  if (entries.length === 0) return { dominant: 'neutral', positiveRatio: 0.5, recentTones: [] };

  const counts: Record<string, number> = {};
  let positive = 0;
  const recentTones = entries.slice(0, 5).map((e) => e.tone);

  for (const e of entries) {
    counts[e.tone] = (counts[e.tone] ?? 0) + 1;
    if (['positive', 'excited', 'calm'].includes(e.tone)) positive++;
  }

  const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'neutral';
  return { dominant, positiveRatio: positive / entries.length, recentTones };
}
