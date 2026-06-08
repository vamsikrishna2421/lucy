/**
 * LUCY Wrapped — quarterly summary of your captured life.
 *
 * Aggregates captures, tasks, expenses, people, mood, and patterns
 * into a set of shareable "slides" shown sequentially (Spotify Wrapped style).
 *
 * Fires once per quarter (Jan, Apr, Jul, Oct) or on demand.
 */

import type { SQLiteDatabase } from 'expo-sqlite';
import { getSetting, setSetting } from '../db/settings';

export interface WrappedSlide {
  id: string;
  category: 'captures' | 'tasks' | 'people' | 'mood' | 'insights' | 'streak' | 'top-topic';
  headline: string;         // Large number or word
  sub: string;              // Explanatory text
  detail?: string;          // Optional secondary detail
  accent: string;           // Hex colour for the slide
  emoji: string;
}

const WRAPPED_LAST_KEY = 'lucy_wrapped_last_shown';
const WRAPPED_DAYS_KEY = 'lucy_wrapped_days_since_install';

/** Number of organized memories available for a Wrapped. */
export async function wrappedMemoryCount(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM captures WHERE processed = 1 AND archived_at IS NULL',
  );
  return Number(row?.n ?? 0);
}

/** True if there are enough memories to generate a meaningful Wrapped (manual view). */
export async function hasEnoughForWrapped(db: SQLiteDatabase): Promise<boolean> {
  return (await wrappedMemoryCount(db)) >= 30;
}

/** Returns true if a Wrapped should AUTO-pop (quarterly cooldown + enough data). */
export async function isWrappedDue(db: SQLiteDatabase): Promise<boolean> {
  const last = await getSetting(db, WRAPPED_LAST_KEY);
  if (last) {
    const daysSince = Math.floor((Date.now() - new Date(last).getTime()) / 86400000);
    if (daysSince < 85) return false; // less than ~3 months
  }
  return hasEnoughForWrapped(db);
}

/** Generates the Wrapped slides from real data. */
export async function generateWrapped(db: SQLiteDatabase): Promise<WrappedSlide[]> {
  const now = new Date();
  // Determine the quarter window
  const quarterStart = new Date(now);
  quarterStart.setMonth(now.getMonth() - 3);
  quarterStart.setHours(0, 0, 0, 0);
  const qStart = quarterStart.toISOString();

  const slides: WrappedSlide[] = [];

  // 1. Total captures
  const captureRow = await db.getFirstAsync<{ total: number; thisQ: number }>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS thisQ
     FROM captures WHERE processed = 1 AND archived_at IS NULL`,
    qStart,
  );
  const totalCaptures = captureRow?.total ?? 0;
  const quarterCaptures = captureRow?.thisQ ?? 0;
  if (quarterCaptures > 0) {
    slides.push({
      id: 'captures',
      category: 'captures',
      headline: quarterCaptures.toString(),
      sub: `thoughts captured this quarter`,
      detail: `${totalCaptures} total memories in your brain`,
      accent: '#FF8C42',
      emoji: '💭',
    });
  }

  // 2. Tasks completed
  const taskRow = await db.getFirstAsync<{ completed: number; total: number }>(
    `SELECT SUM(CASE WHEN status = 'completed' OR status = 'archived' THEN 1 ELSE 0 END) AS completed,
            COUNT(*) AS total
     FROM todos WHERE created_at >= ?`,
    qStart,
  );
  const completedTasks = taskRow?.completed ?? 0;
  if (completedTasks > 0) {
    slides.push({
      id: 'tasks',
      category: 'tasks',
      headline: completedTasks.toString(),
      sub: `tasks completed`,
      detail: `out of ${taskRow?.total ?? 0} captured this quarter`,
      accent: '#4ADE80',
      emoji: '✅',
    });
  }

  // 3. Top person mentioned
  const personRow = await db.getFirstAsync<{ name: string; n: number }>(
    `SELECT name, MAX(mention_count) AS n FROM person_contexts ORDER BY mention_count DESC LIMIT 1`,
  );
  if (personRow?.name) {
    slides.push({
      id: 'person',
      category: 'people',
      headline: personRow.name,
      sub: `most on your mind`,
      detail: `mentioned ${personRow.n} times in your captures`,
      accent: '#60A5FA',
      emoji: '👥',
    });
  }

  // 4. Dominant mood
  const moodRow = await db.getFirstAsync<{ tone: string; n: number }>(
    `SELECT tone, COUNT(*) AS n FROM mood_entries
     WHERE created_at >= ? GROUP BY tone ORDER BY n DESC LIMIT 1`,
    qStart,
  );
  const moodEmoji: Record<string, string> = {
    positive: '😊', excited: '⚡', calm: '😌',
    neutral: '😐', stressed: '😤', frustrated: '😤', negative: '😔',
  };
  const moodColor: Record<string, string> = {
    positive: '#4ADE80', excited: '#FFA05C', calm: '#60A5FA',
    stressed: '#F59E0B', frustrated: '#FB7185', negative: '#FB7185', neutral: '#8A7560',
  };
  if (moodRow?.tone) {
    slides.push({
      id: 'mood',
      category: 'mood',
      headline: moodRow.tone.charAt(0).toUpperCase() + moodRow.tone.slice(1),
      sub: `was your dominant mood`,
      detail: `${moodRow.n} captures with this tone`,
      accent: moodColor[moodRow.tone] ?? '#8A7560',
      emoji: moodEmoji[moodRow.tone] ?? '😐',
    });
  }

  // 5. Capture streak (longest consecutive day streak)
  const dayRows = await db.getAllAsync<{ d: string }>(
    `SELECT DISTINCT date(created_at) AS d FROM captures
     WHERE processed = 1 AND archived_at IS NULL AND created_at >= ?
     ORDER BY d ASC`,
    qStart,
  );
  let maxStreak = 0;
  let curStreak = 0;
  let prevDate: Date | null = null;
  for (const { d } of dayRows) {
    const cur = new Date(d);
    if (prevDate) {
      const diff = Math.round((cur.getTime() - prevDate.getTime()) / 86400000);
      curStreak = diff === 1 ? curStreak + 1 : 1;
    } else {
      curStreak = 1;
    }
    maxStreak = Math.max(maxStreak, curStreak);
    prevDate = cur;
  }
  if (maxStreak >= 3) {
    slides.push({
      id: 'streak',
      category: 'streak',
      headline: `${maxStreak}`,
      sub: `day capture streak`,
      detail: `Your longest unbroken run of daily captures`,
      accent: '#C084FC',
      emoji: '🔥',
    });
  }

  // 6. Top expense category
  const expRow = await db.getFirstAsync<{ category: string; total: number; cnt: number }>(
    `SELECT category, ROUND(SUM(CAST(amount AS REAL)), 2) AS total, COUNT(*) AS cnt
     FROM expenses WHERE created_at >= ?
     GROUP BY category ORDER BY total DESC LIMIT 1`,
    qStart,
  );
  if (expRow?.category && expRow.total > 0) {
    slides.push({
      id: 'expenses',
      category: 'insights',
      headline: `$${expRow.total}`,
      sub: `spent on ${expRow.category}`,
      detail: `${expRow.cnt} expense entries captured`,
      accent: '#F59E0B',
      emoji: '💰',
    });
  }

  // 7. Ideas captured
  const ideaRow = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM ideas WHERE created_at >= ?`, qStart,
  );
  const ideaCount = ideaRow?.n ?? 0;
  if (ideaCount > 0) {
    slides.push({
      id: 'ideas',
      category: 'insights',
      headline: ideaCount.toString(),
      sub: `ideas worth building`,
      detail: `All stored privately in your second brain`,
      accent: '#818CF8',
      emoji: '💡',
    });
  }

  // Final closing slide
  slides.push({
    id: 'close',
    category: 'insights',
    headline: 'Still here.',
    sub: `Your second brain is growing stronger.`,
    detail: `${totalCaptures} memories. More to come.`,
    accent: '#FF8C42',
    emoji: '🧠',
  });

  return slides;
}

export async function markWrappedShown(db: SQLiteDatabase): Promise<void> {
  await setSetting(db, WRAPPED_LAST_KEY, new Date().toISOString());
}
