/**
 * Availability profile (working hours, sleep, protected windows, peak-energy windows).
 * Hybrid: inferred from the learned profile + sensible defaults, shown to the user for
 * confirmation, then persisted and editable. (Locked decision #3.)
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import { getSetting, setSetting } from '../db/settings';
import type { AvailabilityProfile, DailyWindow } from './types';

export const AVAILABILITY_SETTING = 'schedule_availability';

const DEFAULTS: AvailabilityProfile = {
  workStartMin: 9 * 60,
  workEndMin: 18 * 60,
  sleepStartMin: 23 * 60 + 30,
  sleepEndMin: 7 * 60 + 30,
  bufferMin: 10,
  maxFocusMinPerDay: 4 * 60,
  workDays: [1, 2, 3, 4, 5], // Mon–Fri; weekends open
  // Suggested healthy-habit windows (everyone starts with these; the user can edit/remove). Sleep
  // and work hours live in their own fields; these are the daily-rhythm habits LUCY protects + nudges.
  protectedWindows: [
    { label: 'Morning walk', startMin: 7 * 60, endMin: 7 * 60 + 30 },
    { label: 'Lunch', startMin: 12 * 60 + 30, endMin: 13 * 60 + 30 },
    { label: 'Gym', startMin: 18 * 60, endMin: 19 * 60, days: [1, 2, 3, 4, 5] },
    { label: 'Dinner', startMin: 19 * 60 + 30, endMin: 20 * 60 + 30 },
  ],
  peakWindows: [
    { label: 'Morning focus', startMin: 9 * 60, endMin: 11 * 60 + 30 },
  ],
  inferred: true,
  confirmedAt: null,
};

/** Pull a wake time like "7:45" out of the learned profile, if present. */
async function inferWakeMinutes(db: SQLiteDatabase): Promise<number | null> {
  try {
    const rows = await db.getAllAsync<{ statement: string }>('SELECT statement FROM learned_facts');
    for (const r of rows) {
      const m = /\b(?:wake|wakes|wakes up|morning routine|starts? (?:the )?day)\b[^0-9]{0,20}(\d{1,2}):(\d{2})\s*(am|pm)?/i.exec(r.statement);
      if (m) {
        let h = Number(m[1]); const min = Number(m[2]);
        if (/pm/i.test(m[3] || '') && h < 12) h += 12;
        return h * 60 + min;
      }
    }
  } catch { /* ignore */ }
  return null;
}

/** Infer a starting profile from the learned profile (then the user confirms/edits). */
export async function inferAvailability(db: SQLiteDatabase): Promise<AvailabilityProfile> {
  const profile: AvailabilityProfile = JSON.parse(JSON.stringify(DEFAULTS));
  const wake = await inferWakeMinutes(db);
  if (wake != null) {
    profile.sleepEndMin = wake;
    // Peak focus window typically follows wake-up + a short ramp.
    profile.peakWindows = [{ label: 'Morning focus', startMin: wake + 60, endMin: wake + 210 }];
    if (profile.workStartMin < wake + 30) profile.workStartMin = Math.max(profile.workStartMin, wake + 30);
  }
  // Refine the peak window from the actual energy curve if there's enough mood data.
  try {
    const { computePeakWindow } = await import('./energy');
    const learned = await computePeakWindow(db);
    if (learned) profile.peakWindows = [learned];
  } catch { /* keep the wake-derived default */ }
  profile.inferred = true;
  profile.confirmedAt = null;
  return profile;
}

/** Current availability: stored profile if present, else a fresh inference. */
export async function getAvailability(db: SQLiteDatabase): Promise<AvailabilityProfile> {
  const raw = await getSetting(db, AVAILABILITY_SETTING);
  if (raw) {
    try {
      const s = JSON.parse(raw) as Partial<AvailabilityProfile>;
      const merged: AvailabilityProfile = { ...DEFAULTS, ...s };
      // Backfill fields added after the profile was saved (workdays + healthy-habit windows), so
      // existing users get the new defaults instead of an empty/old set.
      if (!Array.isArray(s.workDays) || !s.workDays.length) merged.workDays = DEFAULTS.workDays;
      if (!Array.isArray(s.protectedWindows) || s.protectedWindows.length <= 1) merged.protectedWindows = DEFAULTS.protectedWindows;
      return merged;
    } catch { /* fall through */ }
  }
  return inferAvailability(db);
}

export async function setAvailability(db: SQLiteDatabase, profile: Partial<AvailabilityProfile>): Promise<AvailabilityProfile> {
  const current = await getAvailability(db);
  const merged: AvailabilityProfile = { ...current, ...profile, inferred: false, confirmedAt: new Date().toISOString() };
  await setSetting(db, AVAILABILITY_SETTING, JSON.stringify(merged));
  return merged;
}

/** Whether a daily window applies on a given day-of-week. */
export function windowAppliesOn(w: DailyWindow, dow: number): boolean {
  return !w.days || w.days.includes(dow);
}
