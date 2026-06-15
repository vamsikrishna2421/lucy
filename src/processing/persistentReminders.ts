/**
 * Persistent "nag" reminders — a notification that keeps buzzing until the user acknowledges it.
 *
 * iOS cannot loop a single notification forever, so the realistic cross-platform approach is a
 * SCHEDULED BURST: the first vibrating notification fires at the target time, then one every few
 * minutes for a fixed window. The instant the user taps any of them (handled in App.tsx via
 * acknowledgeNagFromResponse), the whole remaining burst is cancelled. Rescheduling a burst for the
 * same key first cancels the old one, so moving/editing an event doesn't leave stale buzzes.
 *
 * Used for both "remind me…" reminders (key `rem-<id>`) and committed calendar blocks (key
 * `blk-<id>`). expo-notifications is already a native dependency, so this needs no new build —
 * but it ships with the same Codemagic build as the voice features.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

export const ALARM_CHANNEL = 'lucy-alarm';

// Gentle nag: a vibrating notification every 3 minutes for up to 30 minutes (≈10 buzzes), each one
// stoppable by a single tap. (User-chosen cadence — see project_voice / backlog.)
const NAG_INTERVAL_MS = 3 * 60 * 1000;
const NAG_WINDOW_MS = 30 * 60 * 1000;
const NAG_MAX = Math.floor(NAG_WINDOW_MS / NAG_INTERVAL_MS); // 10 occurrences

// A firm, repeating vibration so it's felt without the Critical-Alerts entitlement (which iOS only
// grants special apps). On a phone in silent-no-vibrate mode iOS still can't force a buzz — documented.
const ALARM_VIBRATION = [0, 400, 250, 400, 250, 600];

export async function ensureAlarmChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync(ALARM_CHANNEL, {
      name: 'Alarms & nudges',
      description: 'Reminders and calendar events that buzz until you acknowledge them',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: ALARM_VIBRATION,
      enableVibrate: true,
      sound: 'default',
    });
  } catch { /* best effort */ }
}

async function ensurePermission(): Promise<boolean> {
  try {
    const existing = await Notifications.getPermissionsAsync();
    if (existing.granted) return true;
    const requested = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: false, allowSound: true },
    });
    return requested.granted;
  } catch { return false; }
}

export interface NagInput {
  /** Stable per-entity key, e.g. `rem-12` or `blk-34`. Identifiers derive from it. */
  key: string;
  title: string;
  body: string;
  /** When the first buzz fires (ms epoch). */
  fireAtMs: number;
  data?: Record<string, unknown>;
}

/**
 * Schedules (or re-schedules) a nag burst. Cancels any prior burst for the same key first.
 * Returns the group key when at least one future buzz was scheduled, else null.
 */
export async function scheduleNag(input: NagInput): Promise<string | null> {
  if (!Number.isFinite(input.fireAtMs)) return null;
  if (!(await ensurePermission())) return null;
  await ensureAlarmChannel();
  await cancelNag(input.key); // replace, never stack
  const now = Date.now();
  let scheduled = 0;
  for (let i = 0; i < NAG_MAX; i++) {
    const fireAt = input.fireAtMs + i * NAG_INTERVAL_MS;
    if (fireAt <= now + 5_000) continue; // skip past/imminent slots
    try {
      await Notifications.scheduleNotificationAsync({
        identifier: `nag-${input.key}#${i}`,
        content: {
          title: input.title,
          body: i === 0 ? input.body : `${input.body} · still waiting — tap to dismiss`,
          data: { ...(input.data ?? {}), nagGroup: input.key },
          sound: true,
          vibrate: ALARM_VIBRATION,
        } as Notifications.NotificationContentInput,
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(fireAt),
          channelId: ALARM_CHANNEL,
        },
      });
      scheduled++;
    } catch { /* one slot failing shouldn't abort the rest */ }
  }
  return scheduled > 0 ? input.key : null;
}

/** Cancels every pending + presented buzz in a key's burst (acknowledge / move / delete). */
export async function cancelNag(key: string): Promise<void> {
  for (let i = 0; i < NAG_MAX; i++) {
    const id = `nag-${key}#${i}`;
    await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
    await Notifications.dismissNotificationAsync(id).catch(() => {});
  }
}

/** Tap handler hook (App.tsx): a tapped nag silences its whole remaining burst. */
export async function acknowledgeNagFromResponse(data: Record<string, unknown> | undefined): Promise<void> {
  const key = data && typeof data.nagGroup === 'string' ? data.nagGroup : null;
  if (key) await cancelNag(key);
}
