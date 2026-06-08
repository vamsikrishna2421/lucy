import { useEffect, useState } from 'react';
import * as Notifications from 'expo-notifications';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LUCY_COLORS } from '../config/colors';

interface ScheduledItem {
  id: string;
  title: string;
  body: string;
  kind: string;
  when: string;
}

function describeTrigger(trigger: Notifications.NotificationTrigger | null): string {
  if (!trigger) return 'Unscheduled';
  const t = trigger as unknown as Record<string, unknown>;
  // DATE trigger
  if (typeof t.date === 'number') {
    return new Date(t.date as number).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  if (t.value && typeof t.value === 'number') {
    return new Date(t.value as number).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  // DAILY trigger
  if (typeof t.hour === 'number') {
    const h = t.hour as number;
    const m = (t.minute as number) ?? 0;
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `Daily at ${h12}:${String(m).padStart(2, '0')} ${ampm}`;
  }
  if (typeof t.seconds === 'number') return `In ${Math.round(t.seconds as number)}s${t.repeats ? ' (repeats)' : ''}`;
  return 'Scheduled';
}

export function ScheduledRemindersManager({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [items, setItems] = useState<ScheduledItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => { if (visible) void load(); }, [visible]);

  const load = async () => {
    setLoading(true);
    try {
      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      const rows: ScheduledItem[] = scheduled.map((s) => {
        const data = (s.content.data ?? {}) as Record<string, unknown>;
        return {
          id: s.identifier,
          title: s.content.title ?? 'Reminder',
          body: s.content.body ?? '',
          kind: typeof data.kind === 'string' ? data.kind : 'reminder',
          when: describeTrigger(s.trigger),
        };
      });
      setItems(rows);
    } catch { setItems([]); } finally { setLoading(false); }
  };

  const remove = async (id: string) => {
    try { await Notifications.cancelScheduledNotificationAsync(id); } catch { /* ignore */ }
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  const clearAll = () => {
    Alert.alert('Cancel all reminders?', `This cancels all ${items.length} scheduled notifications, including old ones. Captured reminders can be re-scheduled from your timeline.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Cancel all', style: 'destructive',
        onPress: async () => {
          try { await Notifications.cancelAllScheduledNotificationsAsync(); } catch { /* ignore */ }
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
              <Text style={s.subtitle}>{items.length} scheduled · tap ✕ to cancel any</Text>
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
              <View key={item.id} style={s.row}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={s.rowKind}>{item.kind.toUpperCase()}</Text>
                  <Text style={s.rowTitle} numberOfLines={1}>{item.title}</Text>
                  {item.body ? <Text style={s.rowBody} numberOfLines={2}>{item.body}</Text> : null}
                  <Text style={s.rowWhen}>{item.when}</Text>
                </View>
                <TouchableOpacity onPress={() => void remove(item.id)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
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
  rowBody: { color: LUCY_COLORS.textMuted, fontSize: 12, lineHeight: 17 },
  rowWhen: { color: LUCY_COLORS.textSubtle, fontSize: 11, marginTop: 2 },
  remove: { color: '#ef4444', fontSize: 16, fontWeight: '700' },
});
