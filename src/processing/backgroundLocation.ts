/**
 * Background location tracking for LUCY's travel timeline.
 *
 * Uses Location.startLocationUpdatesAsync so the OS wakes LUCY when the
 * user moves ~1 mile — works even when the app is fully closed.
 * Precision: coarsened to 2 decimal places (~1.1 km, ~1 mile).
 * Frequency: minimum 1 hour between saves (deduped by hour_key in DB).
 */

import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { getDatabase } from '../db';
import { recordLocationSnapshot } from '../db/locationSnapshots';

export const BACKGROUND_LOCATION_TASK = 'lucy-background-location';

// Define the task at module load time (required before any register call).
if (!TaskManager.isTaskDefined(BACKGROUND_LOCATION_TASK)) {
  TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }: TaskManager.TaskManagerTaskBody<{ locations?: Location.LocationObject[] }>) => {
    if (error || !data?.locations?.length) return;
    const loc = data.locations[data.locations.length - 1];
    try {
      const geocode = await Location.reverseGeocodeAsync({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      }).catch(() => []);
      const place = geocode[0];
      const db = await getDatabase();
      await recordLocationSnapshot(
        db,
        place?.city ?? place?.district ?? null,
        place?.region ?? null,
        place?.country ?? null,
        loc.coords.latitude,
        loc.coords.longitude,
      );
    } catch { /* non-critical — travel timeline is supplemental */ }
  });
}

export async function startBackgroundLocationTracking(): Promise<boolean> {
  // Request "Always" permission — required for background tracking.
  const { status: fg } = await Location.requestForegroundPermissionsAsync();
  if (fg !== 'granted') return false;
  const { status: bg } = await Location.requestBackgroundPermissionsAsync();
  if (bg !== 'granted') return false;

  // Don't register twice.
  if (await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)) return true;

  await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
    accuracy: Location.Accuracy.Balanced,
    // Fire when user moves ~1 mile (1600 m).
    distanceInterval: 1600,
    // Ensure at least 1 hour passes between OS deliveries.
    deferredUpdatesInterval: 60 * 60 * 1000,
    deferredUpdatesDistance: 1600,
    // iOS: pause when stationary to save battery.
    pausesUpdatesAutomatically: true,
    activityType: Location.ActivityType.Other,
    // Android: foreground service notification keeps the task alive.
    foregroundService: {
      notificationTitle: 'LUCY — travel context',
      notificationBody: 'Recording city-level location for your travel timeline.',
      notificationColor: '#FF8C42',
    },
    showsBackgroundLocationIndicator: false, // iOS: no blue bar
  });
  return true;
}

export async function stopBackgroundLocationTracking(): Promise<void> {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    }
  } catch { /* ignore */ }
}

export async function isBackgroundLocationActive(): Promise<boolean> {
  try {
    return Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  } catch {
    return false;
  }
}
