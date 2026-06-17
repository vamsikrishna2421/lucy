import { useEffect, useState } from 'react';
import * as Notifications from 'expo-notifications';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LUCY_COLORS } from '../config/colors';
import { getDatabase } from '../db';
import { listReminders, archiveReminder } from '../db/reminders';
import { recurrenceLabel } from '../processing/reminderRecurrence';

interface ScheduledItem {
  key: string;            // nag group key, e.g. "rem-66" / "blk-123"
  reminderId: number | null; // reminders.id when this is a captured reminder
  kind: 'Reminder' | 'Calendar';
  title: string;
  when: string;           // "Repeats daily at 9:00 AM EDT" / "Tue, Jun 24 · 1:00 PM EDT" / "No time set"
}

function triggerMs(trigger: Notifications.NotificationTrigger | null): number | null {
  if (!trigger) return null;
  const t = trigger as unknown as Record<string, unknown>;
  for (const k of ['date', 'value', 'timestamp']) {
    if (typeof t[k] === 'number') return t[k] as number;
  }
  return null;
}
function parseTs(s: string | null): number | null {
  if (!s) return null;
  const ms = new Date(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`).getTime();
  return Number.isFinite(ms) ? ms : null;
}
// Timezone-aware (device local) formatters.
const timeOfDay = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
const dateAndTime = (ms: number) => {
  const date = new Date(ms).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  return `${date} · ${timeOfDay(ms)}`;
};
// Strip the nag suffix: "nag-rem-66#3" -> "rem-66".
const groupKeyFromIdentifier = (id: string) => id.replace(/^nag-/, '').replace(/#\d+$/, '');

export function ScheduledRemindersManager({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [items, setItems] = useState<ScheduledItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => { if (visible) void load(); }, [visible]);

  // Collapse each reminder/calendar-block to ONE row (the nag burst schedules ~10 notifications per
  // item, which used to stack up here). Recurring reminders show as a single "Repeats daily at…"
  // line instead of one row per future date. All times are device-timezone-aware.
  const load = async () => {
    setLoading(true);
    try {
      const db = await getDatabase();
      const reminders = await listReminders(db);
      const remByText = new Map<string, typeof reminders[number]>();
      const remById = new Map<number, typeof reminders[number]>();
      for (const r of reminders) { remById.set(r.id, r); if (r.text) remByText.set(r.text.trim().toLowerCase(), r); }

      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      // Group notifications by their nag group, keeping the EARLIEST fire time (the real next fire).
      const groups = new Map<string, { fireMs: number | null; title: string; body: string; kindData: string }>();
      for (const n of scheduled) {
        const data = (n.content.data ?? {}) as Record<string, unknown>;
        const key = typeof data.nagGroup === 'string' ? data.nagGroup : groupKeyFromIdentifier(n.identifier);
        const fireMs = triggerMs(n.trigger);
        const prev = groups.get(key);
        if (!prev) {
          groups.set(key, { fireMs, title: n.content.title ?? '', body: n.content.body ?? '', kindData: typeof data.kind === 'string' ? data.kind : '' });
        } else if (fireMs !== null && (prev.fireMs === null || fireMs < prev.fireMs)) {
          prev.fireMs = fireMs;
        }
      }

      const rows: ScheduledItem[] = [];
      for (const [key, g] of groups) {
        const isReminder = key.startsWith('rem-') || g.kindData.includes('reminder');
        const reminderId = key.startsWith('rem-') ? Number(key.slice(4)) : null;
        const rem = reminderId !== null ? remById.get(reminderId) : undefined;
        const recur = rem?.recurrence ? recurrenceLabel(rem.recurrence) : '';
        // Prefer the reminder's own text; fall back to the notification body (calendar blocks).
        const title = (rem?.text || g.body || g.title || 'Reminder').replace(/ · tap to dismiss$/i, '').trim();
        const when = recur && g.fireMs !== null ? `Repeats ${recur.toLowerCase()} · next ${timeOfDay(g.fireMs)}`
          : recur ? `Repeats ${recur.toLowerCase()}`
          : g.fireMs !== null ? dateAndTime(g.fireMs)
          : 'No time set';
        rows.push({ key, reminderId, kind: isReminder ? 'Reminder' : 'Calendar', title, when });
      }
      rows.sort((a, b) => a.title.localeCompare(b.title));
      setItems(rows);
    } catch { setItems([]); } finally { setLoading(false); }
  };

  const remove = async (item: ScheduledItem) => {
    try {
      const { cancelNag } = await import('../processing/persistentReminders');
      await cancelNag(item.key);
      if (item.reminderId !== null) {
        const db = await getDatabase();
        await archiveReminder(db, item.reminderId, 'user cancelled from settings');
      }
    } catch { /* ignore */ }
    setItems((prev) => prev.filter((i) => i.key !== item.key));
  };

  const clearAll = () => {
    Alert.alert('Cancel all reminders?', `This cancels all ${items.length} scheduled reminders. You can always capture new ones.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Cancel all', style: 'destructive',
        onPress: async () => {
          try {
            const { cancelNag } = await import('../processing/persistentReminders');
            const db = await getDatabase();
            for (const it of items) {
              await cancelNag(it.key);
              if (it.reminderId !== null) await archiveReminder(db, it.reminderId, 'user cancelled all');
            }
          } catch { /* ignore */ }
          setItems([]);
        },
      },
    ]);
  };

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <View style={s.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[s.sheet, { height: '80%' }]}>
          <View style={s.header}>
            <View style={{ flex: 1 }}>
              <Text style={s.title}>Scheduled reminders</Text>
              <Text style={s.subtitle}>{items.length} active · tap ✕ to cancel</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
              {items.length > 0 ? <TouchableOpacity onPress={clearAll}><Text style={s.clear}>Cancel all</Text></TouchableOpacity> : null}
              <TouchableOpacity onPress={onClose}><Text style={s.close}>Done</Text></TouchableOpacity>
            </View>
          </View>

          <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
            {loading ? (
              <Text style={s.empty}>Loading…</Text>
            ) : items.length === 0 ? (
              <Text style={s.empty}>No scheduled reminders. You're all clear.</Text>
            ) : items.map((item) => (
              <View key={item.key} style={s.row}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={s.rowKind}>{item.kind.toUpperCase()}</Text>
                  <Text style={s.rowTitle} numberOfLines={2}>{item.title}</Text>
                  <Text style={s.rowWhen}>{item.when}</Text>
                </View>
                <TouchableOpacity onPress={() => void remove(item)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Text style={s.remove}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
            <View style={{ height: 24 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: LUCY_COLORS.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderTopColor: LUCY_COLORS.border, padding: 20 },
  header: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  title: { color: LUCY_COLORS.textDark, fontSize: 18, fontWeight: '800' },
  subtitle: { color: LUCY_COLORS.textSubtle, fontSize: 11, marginTop: 3 },
  clear: { color: '#FB7185', fontSize: 13, fontWeight: '700' },
  close: { color: LUCY_COLORS.primary, fontSize: 15, fontWeight: '700' },
  empty: { color: LUCY_COLORS.textSubtle, textAlign: 'center', padding: 32, fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 12, backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 12, marginBottom: 8 },
  rowKind: { color: LUCY_COLORS.primaryGlow, fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  rowTitle: { color: LUCY_COLORS.textDark, fontSize: 14, fontWeight: '700' },
  rowWhen: { color: LUCY_COLORS.textSubtle, fontSize: 11, marginTop: 2 },
  remove: { color: '#ef4444', fontSize: 16, fontWeight: '700' },
});
