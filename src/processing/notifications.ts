import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { ExtractedReminder, PrivacyLevel } from '../types/extraction';
import { containsCredentialSecret } from './privacy';

const REMINDER_CHANNEL = 'lucy-reminders';
const GUARDIAN_CHANNEL = 'lucy-guardian';
const STATUS_CHANNEL = 'lucy-status';
const PERSISTENT_NOTIF_ID = 'lucy-persistent-status';

function stableHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** Writes a notification to the in-app log so it's never lost. */
async function logToInApp(
  kind: string,
  tier: 1 | 2 | 3,
  title: string,
  body: string,
  identifier?: string,
): Promise<void> {
  try {
    const { getDatabase } = await import('../db');
    const db = await getDatabase();
    if (identifier) {
      // Caller supplied a stable id (e.g. a reminder) → upsert so it updates in place.
      const { upsertNotifLog } = await import('../db/notificationLog');
      await upsertNotifLog(db, {
        identifier, kind, tier, title, body,
        scheduled_for: new Date().toISOString(), entity_id: null, entity_kind: null,
      });
    } else {
      // Insight/guardian notification → dedup by content so the SAME insight can't
      // spam the bell. Content-hash key + INSERT-OR-IGNORE means identical text
      // is logged at most once (and a dismissed one won't resurface).
      const { insertDeliveredNotifLog } = await import('../db/notificationLog');
      const dedupKey = `lucy_${kind}_${stableHash(`${title}|${body}`)}`;
      await insertDeliveredNotifLog(db, { dedupKey, kind, tier, title, body: body || null });
    }
    await db.runAsync(
      `DELETE FROM lucy_notifications WHERE id NOT IN
       (SELECT id FROM lucy_notifications ORDER BY created_at DESC LIMIT 200)`,
    );
  } catch { /* non-critical */ }
}

/** Maps a notification kind to its in-app tier (1=urgent, 2=insight, 3=muted). */
function kindToTier(kind: string): 1 | 2 | 3 {
  switch (kind) {
    case 'reminder':
    case 'captured-reminder':
    case 'pre-meeting':
    case 'post-meeting':
      return 1;
    case 'health-tip':
      return 3;
    default:
      return 2; // progress-checkin, morning-brief, weekly-insight, brain-pulse, digest, guardian, etc.
  }
}

/**
 * Logs an OS-delivered notification into the in-app table so it shows in the bell.
 * Called from App.tsx listeners (received / tapped) and the foreground reconcile,
 * covering scheduled pushes (check-ins, reminders) that bypass logToInApp at fire time.
 */
export async function logDeliveredNotification(
  request: Notifications.NotificationRequest,
): Promise<void> {
  try {
    const content = request.content;
    const data = (content.data ?? {}) as Record<string, unknown>;
    const kind = typeof data.kind === 'string' ? data.kind : 'guardian';
    const title = content.title ?? 'LUCY';
    const body = content.body ?? '';
    // Per-occurrence dedup key: a DAILY check-in fires every day with the same
    // request.identifier, so we append today's date to keep one entry per day while
    // still de-duplicating the received-listener vs foreground-reconcile double-log.
    const base = request.identifier || `lucy_${kind}`;
    const day = new Date().toISOString().slice(0, 10);
    const dedupKey = `${base}_${day}`;
    const { getDatabase } = await import('../db');
    const { insertDeliveredNotifLog } = await import('../db/notificationLog');
    const db = await getDatabase();
    await insertDeliveredNotifLog(db, { dedupKey, kind, tier: kindToTier(kind), title, body });
  } catch { /* non-critical */ }
}

/**
 * Reconciles notifications already sitting in the OS tray into the in-app log.
 * Run on app foreground/launch so pushes that fired while the app was closed
 * (e.g. a daily progress check-in) still appear in the bell.
 */
export async function reconcileDeliveredNotifications(): Promise<void> {
  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    for (const n of presented) {
      await logDeliveredNotification(n.request);
    }
  } catch { /* non-critical */ }
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function initializeNotifications(): Promise<void> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL, {
      name: 'Reminders',
      description: 'Time-sensitive reminders',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 150, 250],
    });
    await Notifications.setNotificationChannelAsync(GUARDIAN_CHANNEL, {
      name: 'LUCY insights',
      description: 'Patterns and insights from your second brain',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
    // Low-importance channel for the persistent status strip — no sound, no vibration.
    await Notifications.setNotificationChannelAsync(STATUS_CHANNEL, {
      name: 'LUCY status',
      description: 'Persistent status indicator (always on top)',
      importance: Notifications.AndroidImportance.LOW,
      vibrationPattern: [0],
      enableVibrate: false,
    });
    // Max-importance channel for the persistent "nag" bursts (reminders + calendar events).
    const { ensureAlarmChannel } = await import('./persistentReminders');
    await ensureAlarmChannel();
  }
}

/**
 * Android only: posts a persistent "always-on-top" notification showing today's
 * LUCY activity. It lives in the notification shade permanently (ongoing: true,
 * sticky) so users can tap it to open the notification center from anywhere.
 * On iOS this is not possible — iOS controls notification ordering.
 *
 * Call after app launch and after any significant state change (new capture, pulse, etc.).
 */
export async function updatePersistentStatusNotification(
  capturedToday: number,
  pendingTasks: number,
  unreadInsights: number,
): Promise<void> {
  if (Platform.OS !== 'android') return; // iOS doesn't support persistent notifications
  if (!(await requestNotificationPermission())) return;

  const bodyParts: string[] = [];
  if (capturedToday > 0) bodyParts.push(`${capturedToday} captured today`);
  if (pendingTasks > 0) bodyParts.push(`${pendingTasks} tasks`);
  if (unreadInsights > 0) bodyParts.push(`${unreadInsights} new insights`);
  const body = bodyParts.length > 0 ? bodyParts.join(' · ') : 'Your second brain is ready';

  // Cancel the old one first (same identifier → replace, not stack)
  await Notifications.cancelScheduledNotificationAsync(PERSISTENT_NOTIF_ID).catch(() => {});

  await Notifications.scheduleNotificationAsync({
    identifier: PERSISTENT_NOTIF_ID,
    content: {
      title: 'LUCY',
      body,
      data: { kind: 'status', action: 'open_notification_center' },
      sound: false,
      // Android-specific fields not in Expo types — cast to avoid TS error
      ...(Platform.OS === 'android' ? ({ sticky: true, ongoing: true } as object) : {}),
    } as Notifications.NotificationContentInput,
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: new Date(Date.now() + 500),
      channelId: STATUS_CHANNEL,
    },
  });
}

async function requestNotificationPermission(): Promise<boolean> {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) {
    return true;
  }
  const requested = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: false, allowSound: true },
  });
  return requested.granted;
}

export async function sendGuardianNotification(
  message: string,
  extraData?: Record<string, unknown>,
): Promise<void> {
  const kind = (extraData?.kind as string | undefined) ?? 'guardian';
  // Always log to in-app center (Tier 2 = no push interrupt for ambient insights)
  await logToInApp(kind, 2, 'LUCY', message);
  // Only push for urgent types; guardian-class insights stay in-app only
  if (kind === 'pre-meeting' || kind === 'post-meeting') {
    if (!(await requestNotificationPermission())) return;
    await Notifications.scheduleNotificationAsync({
      content: { title: 'LUCY', body: message, data: { kind, ...(extraData ?? {}) }, sound: true },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(Date.now() + 1000), channelId: REMINDER_CHANNEL },
    });
  }
}

export async function sendDigestNotification(
  title: string,
  body: string,
  openCount?: number,
  followCount?: number,
): Promise<void> {
  // Digest is Tier 2 — in-app only, no push
  await logToInApp('digest', 2, title, body);
}

// Default check-in slots used when the user hasn't customised their own.
export const DEFAULT_CHECKIN_TIMES = ['08:00', '12:00', '17:00'];

/** Picks a contextually appropriate check-in message for the time of day. */
function checkinMessageForHour(hour: number): string {
  if (hour < 11) return 'morning check-in — anything worth capturing before the day gets busy?';
  if (hour < 14) return 'midday check-in — any updates, decisions, or thoughts worth saving?';
  if (hour < 17) return 'quick capture moment — any wins, blockers, or ideas?';
  if (hour < 20) return 'end of the work stretch — anything worth remembering from today?';
  return 'evening check-in — wrap up the day with a quick thought?';
}

/**
 * Schedules a daily progress check-in at each provided "HH:MM" time.
 * Returns a JSON array of the scheduled notification ids (stored so they can be cancelled).
 */
export async function scheduleProgressCheckIn(times?: string[]): Promise<string> {
  if (!(await requestNotificationPermission())) return '';
  const slots = times && times.length > 0 ? times : DEFAULT_CHECKIN_TIMES;
  const ids: string[] = [];
  for (const slot of slots) {
    const [h, m] = slot.split(':').map((n) => Number(n));
    if (!Number.isFinite(h) || !Number.isFinite(m)) continue;
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'hey —',
        body: checkinMessageForHour(h),
        data: { kind: 'progress-checkin' },
        sound: false,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: h,
        minute: m,
      },
    });
    ids.push(id);
  }
  return JSON.stringify(ids);
}

export async function cancelProgressCheckIn(storedValue: string): Promise<void> {
  try {
    const ids: string[] = JSON.parse(storedValue);
    await Promise.all(ids.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => {})));
  } catch { /* already cancelled or invalid */ }
}

/**
 * Schedules a reminder as a PERSISTENT nag: a vibrating notification at the reminder time that keeps
 * buzzing (every few minutes for ~30 min) until the user taps it. Keyed by the reminder ROW id so it
 * can be reliably re-scheduled/cancelled (edit, delete) and so same-text reminders on different dates
 * never collide. Returns the nag group key to store in reminders.notification_id.
 */
export async function scheduleCapturedReminder(
  reminderId: number,
  reminder: ExtractedReminder,
  privacy: PrivacyLevel,
  originalInput: string,
): Promise<string | null> {
  if (!reminder.time) return null;
  const deadlineMs = new Date(reminder.time).getTime();
  if (!Number.isFinite(deadlineMs)) return null;
  if (!(await requestNotificationPermission())) return null;

  const isSecret = containsCredentialSecret(`${originalInput}\n${reminder.text}`);
  const deadlineTime = new Date(deadlineMs).toLocaleTimeString(undefined, {
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
  const title = isSecret ? 'Protected reminder' : 'heads up —';
  const body = isSecret
    ? 'Open LUCY to view a protected reminder.'
    : `${reminder.text} · ${deadlineTime}`;

  const { scheduleNag } = await import('./persistentReminders');
  return scheduleNag({
    key: `rem-${reminderId}`,
    title,
    body,
    fireAtMs: deadlineMs,
    data: { kind: 'captured-reminder', privacy, text: isSecret ? null : reminder.text },
  });
}
