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
export const COST_GUARD_SNOOZE_KEY = 'ai_cost_guard_snooze_until';
export const DEFAULT_MAX_PER_HOUR = 120;

/** Temporarily pause the cost guard for N minutes (auto-resumes after). Pass 0 to resume now. */
export async function snoozeCostGuard(db: SQLiteDatabase, minutes: number): Promise<string | null> {
  const { setSetting } = await import('../db/settings');
  if (minutes <= 0) { await setSetting(db, COST_GUARD_SNOOZE_KEY, ''); return null; }
  const until = new Date(Date.now() + minutes * 60_000).toISOString();
  await setSetting(db, COST_GUARD_SNOOZE_KEY, until);
  return until;
}

/** ISO time the snooze runs until, or null if not snoozed / expired. */
export async function getSnoozeUntil(db: SQLiteDatabase): Promise<string | null> {
  const raw = await getSetting(db, COST_GUARD_SNOOZE_KEY);
  if (!raw) return null;
  return new Date(raw).getTime() > Date.now() ? raw : null;
}

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

export async function getCostGuard(db: SQLiteDatabase): Promise<{ enabled: boolean; max: number; used: number; snoozedUntil: string | null }> {
  const [enabledRaw, maxRaw, used, snoozedUntil] = await Promise.all([
    getSetting(db, COST_GUARD_ENABLED_KEY),
    getSetting(db, COST_GUARD_MAX_KEY),
    aiCallsInLastHour(db),
    getSnoozeUntil(db),
  ]);
  const enabled = enabledRaw !== 'false'; // default ON
  const max = Math.max(1, parseInt(maxRaw ?? '', 10) || DEFAULT_MAX_PER_HOUR);
  return { enabled, max, used, snoozedUntil };
}

/** True if the hourly remote-AI-call cap has been reached (guard on AND not snoozed). */
export async function isAiCallCapReached(db: SQLiteDatabase): Promise<boolean> {
  const { enabled, max, used, snoozedUntil } = await getCostGuard(db);
  if (!enabled || snoozedUntil) return false; // off, or temporarily snoozed
  return used >= max;
}
