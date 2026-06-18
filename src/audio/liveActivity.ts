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
