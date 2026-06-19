/**
 * Live Activity (Dynamic Island) bridge for alarms — thin, fully-guarded wrapper around
 * expo-live-activity. Shows a persistent alarm banner on the Dynamic Island + lock screen while an
 * alarm is active, so it stays visible until the user reacts.
 *
 * Hard iOS constraint: a Live Activity can only be STARTED while the app is in the foreground (or via
 * push, which LUCY has no backend for). So this lights up when an alarm rings with the app open and
 * persists onto the Island/lock screen; a fully-closed-app alarm still relies on the Time-Sensitive
 * notification. Everything here is best-effort and no-ops on Android / iOS < 16.2 / when the native
 * module isn't in the build (so it's safe even before the build that includes it lands).
 */
import { Platform } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';

let LA: typeof import('expo-live-activity') | null = null;
function mod(): typeof import('expo-live-activity') | null {
  if (Platform.OS !== 'ios') return null;
  if (LA) return LA;
  try { LA = require('expo-live-activity') as typeof import('expo-live-activity'); return LA; }
  catch { return null; }
}

/** Start (or returns null) the alarm Live Activity. Returns an id to stop it later. */
export function startAlarmLiveActivity(title: string, subtitle?: string): string | null {
  try {
    const m = mod();
    if (!m?.startActivity) return null;
    const id = m.startActivity(
      { title: title || 'Alarm', subtitle: subtitle || 'Tap the app to dismiss' },
      { backgroundColor: '#0B0B0F', titleColor: '#FFFFFF', subtitleColor: '#FFA05C' },
    );
    return typeof id === 'string' ? id : null;
  } catch { return null; }
}

/** End the alarm Live Activity (safe if id is null or already ended). */
export function stopAlarmLiveActivity(id: string | null, title = 'Alarm'): void {
  if (!id) return;
  try {
    const m = mod();
    m?.stopActivity?.(id, { title });
  } catch { /* ignore */ }
}

// ── Upcoming calendar event Live Activity (countdown on the Dynamic Island) ──────────────────────
// The activity id is PERSISTED, not just kept in memory: a Live Activity outlives the JS (it stays on
// the Island/lock screen while the app is closed — that's iOS by design), and module variables reset on
// relaunch. Without persistence the app would lose the handle and could never end it → a stuck
// "Starting soon" banner forever. We recover the id on next foreground and end it once the event starts.
const LA_ID_KEY = 'live_event_activity_id';
const LA_KEY_KEY = 'live_event_activity_key';
const LA_START_KEY = 'live_event_activity_start';
const START_GRACE_MS = 5 * 60 * 1000; // end the countdown ~5 min after the event begins (don't linger)

let _eventActivityId: string | null = null;
let _eventKey: string | null = null;
let _eventStart = 0;

async function recoverPersisted(db: SQLiteDatabase): Promise<void> {
  if (_eventActivityId) return;
  try {
    const { getSetting } = await import('../db/settings');
    _eventActivityId = (await getSetting(db, LA_ID_KEY)) || null;
    _eventKey = (await getSetting(db, LA_KEY_KEY)) || null;
    _eventStart = Number(await getSetting(db, LA_START_KEY)) || 0;
  } catch { /* ignore */ }
}

/**
 * Show the user's next upcoming committed block on the Dynamic Island + lock screen with a live
 * countdown; END it once the event starts, once it's no longer the next event, or once the opt-in is
 * off. Gated by the "Ring like an alarm" opt-in. Must run in the foreground (iOS won't start/stop a
 * Live Activity from a fully-closed app without a push backend), so it reconciles on every launch.
 */
export async function syncNextEventLiveActivity(): Promise<void> {
  const m = mod();
  if (!m?.startActivity) return;
  try {
    const { getDatabase } = await import('../db');
    const { getSetting } = await import('../db/settings');
    const db = await getDatabase();
    await recoverPersisted(db); // get back the handle after a relaunch so we can end a stale banner
    const now = Date.now();

    // Clear a tracked banner whose event has already started — never leave "Starting soon" stuck.
    if (_eventActivityId && _eventStart && now > _eventStart + START_GRACE_MS) await endNextEventLiveActivity(db);
    if ((await getSetting(db, 'alarm_style_enabled')) !== 'on') { await endNextEventLiveActivity(db); return; }

    const horizon = now + 6 * 60 * 60 * 1000; // only surface events within the next 6 hours
    const row = await db.getFirstAsync<{ id: number; title: string; start_at: number }>(
      "SELECT id, title, start_at FROM scheduled_blocks WHERE status='committed' AND start_at > ? AND start_at < ? ORDER BY start_at ASC LIMIT 1",
      now, horizon,
    );
    if (!row) { await endNextEventLiveActivity(db); return; }
    const key = `evt-${row.id}-${row.start_at}`;
    if (key === _eventKey && _eventActivityId) return; // already showing this one
    await endNextEventLiveActivity(db);
    const id = m.startActivity(
      { title: row.title || 'Upcoming', subtitle: 'Starting soon', progressBar: { date: row.start_at } },
      { backgroundColor: '#0B0B0F', titleColor: '#FFFFFF', subtitleColor: '#FFA05C' },
    );
    if (typeof id === 'string') {
      _eventActivityId = id; _eventKey = key; _eventStart = row.start_at;
      try {
        const { setSetting } = await import('../db/settings');
        await setSetting(db, LA_ID_KEY, id); await setSetting(db, LA_KEY_KEY, key); await setSetting(db, LA_START_KEY, String(row.start_at));
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

export async function endNextEventLiveActivity(db?: SQLiteDatabase): Promise<void> {
  if (_eventActivityId) {
    try { mod()?.stopActivity?.(_eventActivityId, { title: 'Upcoming' }); } catch { /* ignore */ }
  }
  _eventActivityId = null; _eventKey = null; _eventStart = 0;
  try {
    const database = db ?? (await (await import('../db')).getDatabase());
    const { setSetting } = await import('../db/settings');
    await setSetting(database, LA_ID_KEY, ''); await setSetting(database, LA_KEY_KEY, ''); await setSetting(database, LA_START_KEY, '');
  } catch { /* ignore */ }
}
