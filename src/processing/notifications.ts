import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { ExtractedReminder, PrivacyLevel } from '../types/extraction';
import { containsCredentialSecret } from './privacy';

const REMINDER_CHANNEL = 'lucy-reminders';
const GUARDIAN_CHANNEL = 'lucy-guardian';

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
      description: 'Time-sensitive reminders found in captured notes',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 150, 250],
    });
    await Notifications.setNotificationChannelAsync(GUARDIAN_CHANNEL, {
      name: 'LUCY Guardian',
      description: 'LUCY recalled something you were trying to remember',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
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
  if (!(await requestNotificationPermission())) {
    return;
  }
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'I spotted something',
      body: message,
      data: { kind: 'guardian', ...(extraData ?? {}) },
      sound: true,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: new Date(Date.now() + 1000),
      channelId: GUARDIAN_CHANNEL,
    },
  });
}

export async function sendDigestNotification(
  title: string,
  body: string,
  openCount?: number,
  followCount?: number,
): Promise<void> {
  if (!(await requestNotificationPermission())) {
    return;
  }
  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data: { kind: 'digest', openCount: openCount ?? 0, followCount: followCount ?? 0 },
      sound: false,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: new Date(Date.now() + 2000),
      channelId: GUARDIAN_CHANNEL,
    },
  });
}

// Fires every 2 hours during waking hours only (8 AM, 10 AM, 12 PM, 2 PM, 4 PM, 6 PM).
const CHECKIN_HOURS = [8, 10, 12, 14, 16, 18];
const CHECKIN_MESSAGES = [
  "morning check-in — anything worth capturing before the day gets busy?",
  "two hours in — any updates, decisions, or thoughts worth saving?",
  "good time to jot something down. what's been on your plate?",
  "quick capture moment — any wins, blockers, or ideas?",
  "end of the work stretch — anything worth remembering from today?",
  "evening check-in — wrap up the day with a quick thought?",
];

export async function scheduleProgressCheckIn(): Promise<string> {
  if (!(await requestNotificationPermission())) return '';
  const ids: string[] = [];
  for (let i = 0; i < CHECKIN_HOURS.length; i++) {
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'hey —',
        body: CHECKIN_MESSAGES[i],
        data: { kind: 'progress-checkin' },
        sound: false,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: CHECKIN_HOURS[i],
        minute: 0,
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

// How many minutes before the deadline to fire the notification, by urgency.
const REMINDER_LEAD_MINUTES: Record<string, number> = {
  high: 15,
  medium: 30,
  low: 5,
};

export async function scheduleCapturedReminder(
  reminder: ExtractedReminder,
  privacy: PrivacyLevel,
  originalInput: string,
): Promise<string | null> {
  if (!reminder.time) {
    return null;
  }
  const deadlineMs = new Date(reminder.time).getTime();
  if (!Number.isFinite(deadlineMs)) {
    return null;
  }
  const leadMs = (REMINDER_LEAD_MINUTES[reminder.urgency] ?? 15) * 60 * 1000;
  const fireAt = deadlineMs - leadMs;
  // If even the lead-time adjusted date is already past, skip.
  if (fireAt <= Date.now()) {
    return null;
  }
  const date = new Date(fireAt);
  if (!(await requestNotificationPermission())) {
    return null;
  }
  const isSecret = containsCredentialSecret(`${originalInput}\n${reminder.text}`);
  const localTime = date.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
  const body = isSecret
    ? 'Open LUCY to view a protected reminder.'
    : `${reminder.text}\n${localTime}`;
  return Notifications.scheduleNotificationAsync({
    content: {
      title: isSecret ? 'Protected reminder' : 'heads up —',
      body,
      data: { kind: 'captured-reminder', privacy, text: isSecret ? null : reminder.text },
      sound: true,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date,
      channelId: REMINDER_CHANNEL,
    },
  });
}
