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

export async function scheduleCapturedReminder(
  reminder: ExtractedReminder,
  privacy: PrivacyLevel,
  originalInput: string,
): Promise<string | null> {
  if (!reminder.time) {
    return null;
  }
  const date = new Date(reminder.time);
  if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) {
    return null;
  }
  if (!(await requestNotificationPermission())) {
    return null;
  }
  const isSecret = containsCredentialSecret(`${originalInput}\n${reminder.text}`);
  return Notifications.scheduleNotificationAsync({
    content: {
      title: isSecret ? 'Protected reminder' : 'heads up —',
      body: isSecret ? 'Open LUCY to view a protected reminder.' : reminder.text,
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
