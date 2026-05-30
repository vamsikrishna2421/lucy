/**
 * LUCY Geofenced Reminders
 *
 * "Remind me when I get home" → creates a geofence around home location.
 * When user enters that area → notification fires.
 *
 * Uses expo-location's geofencing + expo-task-manager.
 * Requires "Always" location permission for background geofencing.
 */

import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { sendGuardianNotification } from './notifications';
import { getSetting, setSetting } from '../db/settings';
import { getDatabase } from '../db';

const GEOFENCE_TASK = 'lucy-geofence-reminder';
const GEOFENCE_RADIUS_M = 150; // 150 metres (~500 feet)

export interface GeofenceReminder {
  id: string;
  label: string;         // "remind me when I get home"
  reminderText: string;  // what to remind about
  lat: number;
  lng: number;
  createdAt: string;
}

// Register background task (must be at module level)
if (!TaskManager.isTaskDefined(GEOFENCE_TASK)) {
  TaskManager.defineTask(GEOFENCE_TASK, async ({ data, error }) => {
    if (error) return;
    const { eventType, region } = (data as any) ?? {};
    if (eventType !== Location.GeofencingEventType.Enter) return;

    // Find the reminder for this region
    const db = await getDatabase();
    const remindersJson = await getSetting(db, 'geofence_reminders');
    if (!remindersJson) return;

    const reminders: GeofenceReminder[] = JSON.parse(remindersJson);
    const matched = reminders.find((r) => r.id === region?.identifier);
    if (!matched) return;

    await sendGuardianNotification(
      matched.reminderText,
      { kind: 'geofence', locationLabel: matched.label },
    );

    // Remove one-shot reminders after firing
    const updated = reminders.filter((r) => r.id !== matched.id);
    await setSetting(db, 'geofence_reminders', JSON.stringify(updated));

    // Update geofence regions
    await syncGeofences(updated);
  });
}

// ─── Public API ────────────────────────────────────────────────────────────────

export async function requestGeofencePermission(): Promise<boolean> {
  const { status: fg } = await Location.requestForegroundPermissionsAsync();
  if (fg !== 'granted') return false;
  const { status: bg } = await Location.requestBackgroundPermissionsAsync();
  return bg === 'granted';
}

export async function createGeofenceReminder(
  reminderText: string,
  locationLabel: string,
): Promise<{ success: boolean; message: string }> {
  // Check permission
  const { status } = await Location.getBackgroundPermissionsAsync();
  if (status !== 'granted') {
    const granted = await requestGeofencePermission();
    if (!granted) {
      return { success: false, message: 'Location permission needed for geofenced reminders. Go to Settings → LUCY → Location → Always.' };
    }
  }

  // Get current location as approximation of "home" or user's current spot
  // In real use, user would specify the location name — for now use current position
  const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  const db = await getDatabase();

  const reminder: GeofenceReminder = {
    id: `geo-${Date.now()}`,
    label: locationLabel,
    reminderText,
    lat: location.coords.latitude,
    lng: location.coords.longitude,
    createdAt: new Date().toISOString(),
  };

  const existingJson = await getSetting(db, 'geofence_reminders');
  const existing: GeofenceReminder[] = existingJson ? JSON.parse(existingJson) : [];
  const updated = [...existing, reminder];
  await setSetting(db, 'geofence_reminders', JSON.stringify(updated));
  await syncGeofences(updated);

  return { success: true, message: `Got it — I'll remind you when you get to ${locationLabel}` };
}

async function syncGeofences(reminders: GeofenceReminder[]): Promise<void> {
  try {
    await Location.stopGeofencingAsync(GEOFENCE_TASK).catch(() => {});
    if (reminders.length === 0) return;

    await Location.startGeofencingAsync(
      GEOFENCE_TASK,
      reminders.map((r) => ({
        identifier: r.id,
        latitude:   r.lat,
        longitude:  r.lng,
        radius:     GEOFENCE_RADIUS_M,
        notifyOnEnter: true,
        notifyOnExit:  false,
      })),
    );
  } catch { /* non-critical */ }
}

export async function getActiveGeofences(): Promise<GeofenceReminder[]> {
  const db = await getDatabase();
  const json = await getSetting(db, 'geofence_reminders');
  return json ? JSON.parse(json) : [];
}

export async function deleteGeofence(id: string): Promise<void> {
  const db = await getDatabase();
  const json = await getSetting(db, 'geofence_reminders');
  if (!json) return;
  const reminders: GeofenceReminder[] = JSON.parse(json);
  const updated = reminders.filter((r) => r.id !== id);
  await setSetting(db, 'geofence_reminders', JSON.stringify(updated));
  await syncGeofences(updated);
}
