/**
 * Medication reminders — schedules a DAILY local notification at each dose time for a medication
 * ("Time for Metformin · 500mg"). Stable per-dose identifiers (med-<id>-<HH:MM>) so they can be
 * cancelled when the med is stopped/edited. Honors the user's "Ring like an alarm" choice indirectly:
 * these are gentle daily reminders (not the alarm burst) — meds are routine, not alarms.
 */
import * as Notifications from 'expo-notifications';
import { parseTimes, type MedicationRow } from '../db/medications';

function idFor(medId: number, time: string): string { return `med-${medId}-${time}`; }

export async function scheduleMedReminders(med: MedicationRow): Promise<void> {
  const times = parseTimes(med.times);
  if (!times.length) return;
  try {
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) { const req = await Notifications.requestPermissionsAsync(); if (!req.granted) return; }
  } catch { return; }
  for (const t of times) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
    if (!m) continue;
    const hour = Number(m[1]); const minute = Number(m[2]);
    if (hour > 23 || minute > 59) continue;
    try {
      await Notifications.scheduleNotificationAsync({
        identifier: idFor(med.id, t),
        content: {
          title: '💊 Medication',
          body: `Time for ${med.name}${med.dosage ? ` · ${med.dosage}` : ''}`,
          data: { kind: 'medication', medicationId: med.id, timeLabel: t },
          sound: true,
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute },
      });
    } catch { /* one time failing shouldn't abort the rest */ }
  }
}

export async function cancelMedReminders(med: MedicationRow): Promise<void> {
  for (const t of parseTimes(med.times)) {
    await Notifications.cancelScheduledNotificationAsync(idFor(med.id, t)).catch(() => {});
  }
}
