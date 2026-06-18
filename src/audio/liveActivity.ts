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
let _eventActivityId: string | null = null;
let _eventKey: string | null = null;

/**
 * Show the user's next upcoming committed block on the Dynamic Island + lock screen with a live
 * countdown, ending it once it passes (or replacing it when a nearer event appears). Gated by the
 * "Ring like an alarm" opt-in so the Island isn't used without consent. Must be called from the
 * foreground (iOS won't start a Live Activity from a closed app without push). Best-effort + guarded.
 */
export async function syncNextEventLiveActivity(): Promise<void> {
  const m = mod();
  if (!m?.startActivity) return;
  try {
    const { getDatabase } = await import('../db');
    const { getSetting } = await import('../db/settings');
    const db = await getDatabase();
    if ((await getSetting(db, 'alarm_style_enabled')) !== 'on') { endNextEventLiveActivity(); return; }
    const now = Date.now();
    const horizon = now + 6 * 60 * 60 * 1000; // only surface events within the next 6 hours
    const row = await db.getFirstAsync<{ id: number; title: string; start_at: number }>(
      "SELECT id, title, start_at FROM scheduled_blocks WHERE status='committed' AND start_at > ? AND start_at < ? ORDER BY start_at ASC LIMIT 1",
      now, horizon,
    );
    if (!row) { endNextEventLiveActivity(); return; }
    const key = `evt-${row.id}-${row.start_at}`;
    if (key === _eventKey && _eventActivityId) return; // already showing this one
    endNextEventLiveActivity();
    const id = m.startActivity(
      { title: row.title || 'Upcoming', subtitle: 'Starting soon', progressBar: { date: row.start_at } },
      { backgroundColor: '#0B0B0F', titleColor: '#FFFFFF', subtitleColor: '#FFA05C' },
    );
    if (typeof id === 'string') { _eventActivityId = id; _eventKey = key; }
  } catch { /* ignore */ }
}

export function endNextEventLiveActivity(): void {
  if (_eventActivityId) {
    try { mod()?.stopActivity?.(_eventActivityId, { title: 'Upcoming' }); } catch { /* ignore */ }
    _eventActivityId = null; _eventKey = null;
  }
}
