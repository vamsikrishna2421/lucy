import type { SQLiteDatabase } from 'expo-sqlite';
import { getDatabase } from '../db';
import { getSetting } from '../db/settings';

/**
 * Cost guard: a rolling cap on remote AI calls per hour. When the cap is hit the
 * processing queue PAUSES (captures stay queued, nothing fails) until the window
 * clears — so a runaway can never silently burn through credits.
 */
export const COST_GUARD_ENABLED_KEY = 'ai_cost_guard_enabled';
export const COST_GUARD_MAX_KEY = 'ai_cost_guard_max_per_hour';
export const DEFAULT_MAX_PER_HOUR = 120;

/** Record one remote AI call. Best-effort; never throws. */
export async function recordAiCall(db?: SQLiteDatabase): Promise<void> {
  try {
    const database = db ?? (await getDatabase());
    await database.runAsync('INSERT INTO ai_call_log DEFAULT VALUES');
    // Keep the log small — only the last 24h matters for an hourly window.
    await database.runAsync("DELETE FROM ai_call_log WHERE called_at < datetime('now', '-24 hours')");
  } catch { /* best-effort */ }
}

export async function aiCallsInLastHour(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM ai_call_log WHERE called_at >= datetime('now', '-1 hour')",
  );
  return Number(row?.n ?? 0);
}

export async function getCostGuard(db: SQLiteDatabase): Promise<{ enabled: boolean; max: number; used: number }> {
  const [enabledRaw, maxRaw, used] = await Promise.all([
    getSetting(db, COST_GUARD_ENABLED_KEY),
    getSetting(db, COST_GUARD_MAX_KEY),
    aiCallsInLastHour(db),
  ]);
  const enabled = enabledRaw !== 'false'; // default ON
  const max = Math.max(1, parseInt(maxRaw ?? '', 10) || DEFAULT_MAX_PER_HOUR);
  return { enabled, max, used };
}

/** True if the hourly remote-AI-call cap has been reached (and the guard is on). */
export async function isAiCallCapReached(db: SQLiteDatabase): Promise<boolean> {
  const { enabled, max, used } = await getCostGuard(db);
  return enabled && used >= max;
}
