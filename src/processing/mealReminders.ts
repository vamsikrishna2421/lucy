/**
 * Meal-photo reminders — the "cue" half of the food-logging habit loop (opt-in). Gentle daily nudges
 * at typical meal times that say "snap your meal"; tapping one opens the camera straight to meal mode
 * (the friction-free "action"), and the logging streak is the "reward". Opt-in only (default off) so
 * it never nags users who don't want it.
 */
import * as Notifications from 'expo-notifications';

// Typical meal windows (local time). Gentle, not alarm-grade.
const MEAL_TIMES: Array<{ id: string; hour: number; minute: number; label: string }> = [
  { id: 'breakfast', hour: 8, minute: 30, label: 'Breakfast?' },
  { id: 'lunch', hour: 13, minute: 0, label: 'Lunch time?' },
  { id: 'dinner', hour: 19, minute: 30, label: 'Dinner?' },
];

function idFor(meal: string): string { return `meal-nudge-${meal}`; }

export async function scheduleMealReminders(): Promise<void> {
  try {
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) { const r = await Notifications.requestPermissionsAsync(); if (!r.granted) return; }
  } catch { return; }
  for (const m of MEAL_TIMES) {
    try {
      await Notifications.scheduleNotificationAsync({
        identifier: idFor(m.id),
        content: {
          title: `🍽️ ${m.label}`,
          body: 'Snap a photo of your meal — one tap and LUCY logs the calories.',
          data: { kind: 'meal-nudge', meal: m.id },
          sound: false, // gentle, not an alarm
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: m.hour, minute: m.minute },
      });
    } catch { /* one slot failing shouldn't abort the rest */ }
  }
}

export async function cancelMealReminders(): Promise<void> {
  for (const m of MEAL_TIMES) {
    await Notifications.cancelScheduledNotificationAsync(idFor(m.id)).catch(() => {});
  }
}
