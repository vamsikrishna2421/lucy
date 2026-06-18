/**
 * In-app persistent alarm — the "won't stop until I react" experience while the app is open.
 *
 * When an alarm-grade nag (calendar block / reminder) fires in the foreground, or the user taps one of
 * its notifications, this raises a full-screen ringing overlay (AlarmOverlay) that loops haptics until
 * the user reacts (Dismiss or Snooze). It complements the background notification burst (which, with the
 * Time-Sensitive entitlement, breaks through Focus). True until-acked persistence on a CLOSED app needs a
 * Live Activity via push — see docs/ALARM_NOTIFICATIONS.md.
 */
import * as Haptics from 'expo-haptics';
import { startAlarmLiveActivity, stopAlarmLiveActivity } from './liveActivity';

export interface ActiveAlarm { key: string; title: string; body: string }

class AlarmManager {
  private current: ActiveAlarm | null = null;
  private listeners = new Set<(a: ActiveAlarm | null) => void>();
  private buzzTimer: ReturnType<typeof setInterval> | null = null;
  private activityId: string | null = null; // Dynamic Island / lock-screen Live Activity

  subscribe(fn: (a: ActiveAlarm | null) => void): () => void {
    this.listeners.add(fn);
    fn(this.current);
    return () => { this.listeners.delete(fn); };
  }
  private emit(): void { for (const l of this.listeners) l(this.current); }

  /** Raise the alarm overlay and start the repeating buzz. Ignores a repeat for the same key. */
  ring(alarm: ActiveAlarm): void {
    if (this.current?.key === alarm.key) return;
    this.current = alarm;
    this.startBuzz();
    // Persist it onto the Dynamic Island + lock screen (best-effort; no-op pre-build/Android).
    this.activityId = startAlarmLiveActivity(alarm.body || alarm.title, "Tap to dismiss in LUCY");
    this.emit();
  }

  private startBuzz(): void {
    this.stopBuzz();
    const buzz = () => { void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {}); };
    buzz();
    this.buzzTimer = setInterval(buzz, 1500);
  }
  private stopBuzz(): void {
    if (this.buzzTimer) { clearInterval(this.buzzTimer); this.buzzTimer = null; }
  }

  /** User reacted (Dismiss) — silence the buzz, clear the overlay, and cancel the remaining burst. */
  async dismiss(): Promise<void> {
    const key = this.current?.key;
    this.stopBuzz();
    this.endActivity();
    this.current = null;
    this.emit();
    if (key) {
      try { const { cancelNag } = await import('../processing/persistentReminders'); await cancelNag(key); } catch { /* ignore */ }
    }
  }

  private endActivity(): void {
    if (this.activityId) { stopAlarmLiveActivity(this.activityId); this.activityId = null; }
  }

  /** Snooze: silence now, cancel the current burst, and re-ring in `minutes`. */
  async snooze(minutes = 10): Promise<void> {
    const alarm = this.current;
    this.stopBuzz();
    this.endActivity();
    this.current = null;
    this.emit();
    if (!alarm) return;
    try {
      const { cancelNag, scheduleNag } = await import('../processing/persistentReminders');
      await cancelNag(alarm.key);
      await scheduleNag({ key: alarm.key, title: alarm.title, body: alarm.body, fireAtMs: Date.now() + minutes * 60_000 });
    } catch { /* ignore */ }
  }

  getCurrent(): ActiveAlarm | null { return this.current; }
}

export const alarmManager = new AlarmManager();

/** From a tapped/received notification payload, raise the in-app alarm if it's an alarm-grade nag. */
export function ringFromNotificationData(data: Record<string, unknown> | undefined, title: string, body: string): void {
  if (!data || typeof data.nagGroup !== 'string') return;
  alarmManager.ring({ key: data.nagGroup, title: title || 'Reminder', body: body || '' });
}
