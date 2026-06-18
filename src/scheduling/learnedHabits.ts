/**
 * Learned activity suggestions — replaces the old HARDCODED habit windows (gym/lunch/walk at fixed
 * times) with suggestions derived from the user's OWN routine. We look at the activities they've
 * actually committed to their calendar before, find the ones they repeat, and propose those same
 * activities at their usual time on the days they usually do them. Surfaced as the existing
 * approve/ignore habit chips — nothing is committed until the user taps ✓ (their time stays free).
 */
import type { SQLiteDatabase } from 'expo-sqlite';

export interface LearnedHabit {
  title: string;
  startMin: number; // minutes from local midnight
  endMin: number;
  days: number[];   // 0=Sun..6=Sat the user tends to do it
  count: number;    // how many times it's been seen (confidence)
}

const norm = (s: string): string => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const median = (arr: number[]): number => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? 0; };

/**
 * Derive repeated routines from the user's committed calendar blocks. A title committed 2+ times
 * becomes a learned habit at its median time-of-day + duration, on the weekdays it's appeared on.
 * Pure read; safe to call on every schedule load.
 */
export async function deriveLearnedHabits(db: SQLiteDatabase): Promise<LearnedHabit[]> {
  let rows: Array<{ title: string; start_at: number; end_at: number }> = [];
  try {
    rows = await db.getAllAsync<{ title: string; start_at: number; end_at: number }>(
      "SELECT title, start_at, end_at FROM scheduled_blocks WHERE status='committed'",
    );
  } catch { return []; }

  const groups = new Map<string, { title: string; mins: number[]; durs: number[]; days: Set<number> }>();
  for (const r of rows) {
    if (!r.title || !Number.isFinite(r.start_at) || !Number.isFinite(r.end_at)) continue;
    const d = new Date(r.start_at);
    if (Number.isNaN(d.getTime())) continue;
    const startMin = d.getHours() * 60 + d.getMinutes();
    const dur = Math.max(15, Math.round((r.end_at - r.start_at) / 60_000));
    const key = norm(r.title);
    if (!key) continue;
    const g = groups.get(key) ?? { title: r.title, mins: [], durs: [], days: new Set<number>() };
    g.mins.push(startMin); g.durs.push(dur); g.days.add(d.getDay());
    groups.set(key, g);
  }

  const habits: LearnedHabit[] = [];
  for (const g of groups.values()) {
    if (g.mins.length < 2) continue; // need a real repetition to call it a habit
    const startMin = median(g.mins);
    const dur = median(g.durs);
    habits.push({
      title: g.title, startMin, endMin: Math.min(24 * 60 - 1, startMin + dur),
      days: [...g.days].sort((a, b) => a - b), count: g.mins.length,
    });
  }
  // Strongest routines first, capped so the day grid isn't cluttered.
  return habits.sort((a, b) => b.count - a.count).slice(0, 8);
}
