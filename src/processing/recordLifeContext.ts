/**
 * Records a snapshot of where the user is and how they're doing physically.
 * Called when the app becomes active (foreground) — uses only foreground permissions.
 * One location snapshot per day, health snapshot updated throughout the day.
 */

import type { SQLiteDatabase } from 'expo-sqlite';
import { recordLocationSnapshot } from '../db/locationSnapshots';
import { upsertHealthSnapshot } from '../db/healthSnapshots';

export async function recordLifeContextSnapshot(db: SQLiteDatabase): Promise<void> {
  // Run both in parallel — failures are silently ignored (this is supplemental data)
  await Promise.allSettled([
    recordCurrentLocation(db),
    recordCurrentHealth(db),
  ]);
}

/** Health-only snapshot — used when background location is active (avoids double-recording). */
export async function recordCurrentHealthOnly(db: SQLiteDatabase): Promise<void> {
  await recordCurrentHealth(db).catch(() => {});
}

export async function recordCurrentLocation(db: SQLiteDatabase): Promise<void> {
  const Location = await import('expo-location');
  const { status } = await Location.getForegroundPermissionsAsync();
  if (status !== 'granted') return;

  const pos = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });

  const geocode = await Location.reverseGeocodeAsync({
    latitude: pos.coords.latitude,
    longitude: pos.coords.longitude,
  }).catch(() => []);

  const place = geocode[0];
  await recordLocationSnapshot(
    db,
    place?.city ?? place?.district ?? null,
    place?.region ?? null,
    place?.country ?? null,
    pos.coords.latitude,
    pos.coords.longitude,
  );
}

async function recordCurrentHealth(db: SQLiteDatabase): Promise<void> {
  const dateKey = new Date().toISOString().slice(0, 10);
  let steps = 0;
  let sleepHours: number | null = null;
  let restingHr: number | null = null;

  // Steps via Pedometer (expo-sensors — no special permission on iOS)
  try {
    const { Pedometer } = await import('expo-sensors');
    const available = await Pedometer.isAvailableAsync();
    if (available) {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const result = await Pedometer.getStepCountAsync(start, new Date());
      steps = result.steps ?? 0;
    }
  } catch { /* Pedometer not available */ }

  // Sleep + HR via @kingstinct/react-native-healthkit (optional)
  try {
    const HK = require('@kingstinct/react-native-healthkit') as {
      default: {
        requestAuthorization(read: string[], write: string[]): Promise<void>;
        querySleepSamplesForToday(date?: Date): Promise<Array<{ value: string; startDate: string; endDate: string }>>;
        getMostRecentQuantitySample(id: string, unit: string): Promise<{ quantity: number } | null>;
      };
    };
    const hk = HK.default;
    await hk.requestAuthorization(['SleepAnalysis', 'RestingHeartRate'], []);

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const [sleepSamples, hrSample] = await Promise.all([
      hk.querySleepSamplesForToday(yesterday).catch(() => []),
      hk.getMostRecentQuantitySample('HKQuantityTypeIdentifierRestingHeartRate', 'count/min').catch(() => null),
    ]);

    let totalSleepMs = 0;
    for (const s of sleepSamples) {
      if (s.value === 'ASLEEP' || s.value === 'INBED') {
        totalSleepMs += new Date(s.endDate).getTime() - new Date(s.startDate).getTime();
      }
    }
    if (totalSleepMs > 0) sleepHours = Math.round((totalSleepMs / 3_600_000) * 10) / 10;
    restingHr = hrSample?.quantity ?? null;
  } catch { /* HealthKit not available */ }

  await upsertHealthSnapshot(db, dateKey, steps, sleepHours, restingHr, null);
}

/** Generates a plain-text health tip for the morning brief / Brain Pulse. */
export function generateHealthTip(steps: number, sleepHours: number | null, restingHr: number | null): string | null {
  const tips: string[] = [];

  if (sleepHours !== null) {
    if (sleepHours < 5.5) tips.push(`Only ${sleepHours}h sleep — keep decisions light today and prioritise rest tonight.`);
    else if (sleepHours < 7) tips.push(`${sleepHours}h sleep — decent but aim for 7+ to sustain focus through the afternoon.`);
    else tips.push(`${sleepHours}h sleep — well rested. Good day for demanding work.`);
  }

  if (steps > 0) {
    if (steps < 2000) tips.push(`${steps.toLocaleString()} steps so far — even a 10-min walk improves cognitive performance by ~15%.`);
    else if (steps >= 10000) tips.push(`${steps.toLocaleString()} steps — excellent movement. Your brain benefits from this.`);
  }

  if (restingHr !== null) {
    if (restingHr > 80) tips.push(`Resting HR at ${restingHr} bpm is slightly elevated — stress or caffeine can cause this.`);
    else if (restingHr < 55) tips.push(`Resting HR at ${restingHr} bpm — cardiovascular fitness is excellent.`);
  }

  return tips.length > 0 ? tips[0] : null;
}
