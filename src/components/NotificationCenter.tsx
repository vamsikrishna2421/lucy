import { useEffect, useRef, useState } from 'react';
import {
  Animated, FlatList, Modal, Pressable, StyleSheet,
  Text, TouchableOpacity, View, useWindowDimensions,
} from 'react-native';
import { LUCY_COLORS } from '../config/colors';
import { getDatabase } from '../db';
import {
  dismissNotif, listNotifLog, markAllInsightsRead, markNotifRead,
  type NotifFilter, type NotifLogRow,
} from '../db/notificationLog';

// ─── Icon + colour map ────────────────────────────────────────────────────────

const KIND_GLYPH: Record<string, string> = {
  'reminder': '◷', 'meeting-brief': '◈', 'pre-meeting': '◈',
  'morning-brief': '◐', 'weekly-insight': '◉', 'on-this-day': '◑',
  'brain-pulse': '◍', 'digest': '◌', 'guardian': '◆',
  'open-loop': '◻', 'health-tip': '◑', 'progress-checkin': '◈',
  'context-request': '◷', 'post-meeting': '◎',
};

const KIND_LABEL: Record<string, string> = {
  'reminder': 'REMINDER', 'meeting-brief': 'MEETING', 'pre-meeting': 'MEETING',
  'morning-brief': 'BRIEF', 'weekly-insight': 'WEEKLY', 'on-this-day': 'MEMORY',
  'brain-pulse': 'PULSE', 'digest': 'DIGEST', 'guardian': 'PATTERN',
  'open-loop': 'LOOP', 'health-tip': 'HEALTH', 'progress-checkin': 'CHECK-IN',
  'context-request': 'CONTEXT', 'post-meeting': 'MEETING',
};

const TIER_COLOR: Record<number, string> = {
  1: LUCY_COLORS.primary,    // #FF8C42 — urgent amber
  2: '#C084FC',              // violet — insights
  3: LUCY_COLORS.textSubtle, // #8A7560 — muted
};

function formatAge(iso: string): string {
  const ms = Date.now() - new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ─── Row ──────────────────────────────────────────────────────────────────────

function NotifRow({ item, onRead, onDismiss }: {
  item: NotifLogRow;
  onRead: (id: number) => void;
  onDismiss: (id: number) => void;
}) {
  const tier = item.tier as 1 | 2 | 3;
  const accent = TIER_COLOR[tier] ?? LUCY_COLORS.textSubtle;
  const glyph = KIND_GLYPH[item.kind] ?? '◆';
  const label = KIND_LABEL[item.kind] ?? item.kind.toUpperCase();
  const isUnread = !item.read_at;
  const isExpired = !!item.expired_at;

  return (
    <TouchableOpacity
      style={[styles.row, isUnread && !isExpired && styles.rowUnread]}
      onPress={() => onRead(item.id)}
      activeOpacity={0.75}
    >
      {isUnread && !isExpired ? <View style={[styles.unreadBar, { backgroundColor: accent }]} /> : null}
      <View style={[styles.iconWrap, { backgroundColor: `${accent}22` }]}>
        <Text style={[styles.iconGlyph, { color: accent, opacity: isExpired ? 0.4 : 1 }]}>{glyph}</Text>
      </View>
      <View style={[styles.content, isExpired && { opacity: 0.45 }]}>
        <View style={styles.topRow}>
          <View style={[styles.badge, { backgroundColor: `${accent}22` }]}>
            <Text style={[styles.badgeText, { color: accent }]}>{label}</Text>
          </View>
          {isExpired ? <Text style={styles.expiredLabel}>EXPIRED</Text> : null}
        </View>
        <Text style={[styles.title, isUnread && !isExpired && styles.titleUnread]} numberOfLines={2}>
          {item.title}
        </Text>
        {item.body ? <Text style={styles.body} numberOfLines={3}>{item.body}</Text> : null}
        <Text style={styles.age}>{formatAge(item.created_at)}</Text>
      </View>
      <TouchableOpacity
        style={styles.dismissBtn}
        onPress={() => onDismiss(item.id)}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      >
        <Text style={styles.dismissIcon}>✕</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function NotificationCenter({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [filter, setFilter] = useState<NotifFilter>('all');
  const [items, setItems] = useState<NotifLogRow[]>([]);
  const slideAnim = useRef(new Animated.Value(800)).current;
  const { height: screenHeight } = useWindowDimensions();
  // Sheet is maxHeight 92%. Fixed inside: handle(20px) + header(~54px) + filterRow(~50px) + padding
  const listHeight = Math.max(200, Math.round(screenHeight * 0.88) - 140);

  useEffect(() => {
    if (visible) {
      setFilter('all');
      Animated.spring(slideAnim, { toValue: 0, friction: 20, tension: 160, useNativeDriver: true }).start();
      void loadItems();
    } else {
      Animated.timing(slideAnim, { toValue: 800, duration: 220, useNativeDriver: true }).start();
    }
  }, [visible]);

  useEffect(() => {
    if (visible) void loadItems();
  }, [filter]);

  const loadItems = async () => {
    try {
      const db = await getDatabase();
      const rows = await listNotifLog(db, filter);
      setItems(rows);
    } catch (e) {
      console.error('[NotificationCenter] loadItems failed:', e);
      setItems([]);
    }
  };

  const handleRead = async (id: number) => {
    const db = await getDatabase();
    await markNotifRead(db, id);
    setItems((prev) => prev.map((n) => n.id === id ? { ...n, read_at: new Date().toISOString() } : n));
  };

  const handleDismiss = async (id: number) => {
    const db = await getDatabase();
    await dismissNotif(db, id);
    setItems((prev) => prev.filter((n) => n.id !== id));
  };

  const handleMarkAllRead = async () => {
    const db = await getDatabase();
    await markAllInsightsRead(db);
    await loadItems();
  };

  const filters: { key: NotifFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'urgent', label: 'Urgent' },
    { key: 'insights', label: 'Insights' },
    { key: 'muted', label: 'Muted' },
  ];

  const unreadCount = items.filter((n) => !n.read_at && !n.expired_at).length;

  return (
    <Modal transparent animationType="none" visible={visible} onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <Animated.View style={[styles.sheet, { transform: [{ translateY: slideAnim }] }]}>
          <View>
            {/* Drag handle */}
            <View style={styles.handle} />

            {/* Header */}
            <View style={styles.header}>
              <Text style={styles.headerTitle}>Notifications</Text>
              <View style={styles.headerRight}>
                {unreadCount > 0 ? (
                  <TouchableOpacity onPress={() => void handleMarkAllRead()} style={styles.markAllBtn}>
                    <Text style={styles.markAllText}>Mark all read</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity onPress={onClose}>
                  <Text style={styles.doneBtn}>Done</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Filter tabs */}
            <View style={styles.filterRow}>
              {filters.map(({ key, label }) => (
                <TouchableOpacity
                  key={key}
                  style={[styles.filterTab, filter === key && styles.filterTabActive]}
                  onPress={() => setFilter(key)}
                >
                  <Text style={[styles.filterText, filter === key && styles.filterTextActive]}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* List */}
            <FlatList
              data={items}
              keyExtractor={(item) => String(item.id)}
              renderItem={({ item }) => (
                <NotifRow item={item} onRead={handleRead} onDismiss={handleDismiss} />
              )}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
              style={[styles.list, { height: listHeight }]}
              showsVerticalScrollIndicator={false}
              ListEmptyComponent={() => (
                <View style={styles.emptyWrap}>
                  <Text style={styles.emptyIcon}>◌</Text>
                  <Text style={styles.emptyText}>No notifications</Text>
                  <Text style={styles.emptySub}>LUCY will surface patterns, reminders, and insights here.</Text>
                </View>
              )}
            />
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', flexDirection: 'column' },
  sheet: {
    backgroundColor: LUCY_COLORS.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderTopWidth: 1, borderColor: LUCY_COLORS.border, maxHeight: '92%', minHeight: 300,
  },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: LUCY_COLORS.border, alignSelf: 'center', marginTop: 10, marginBottom: 6 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12 },
  headerTitle: { color: LUCY_COLORS.textDark, fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  markAllBtn: {},
  markAllText: { color: LUCY_COLORS.textSubtle, fontSize: 13, fontWeight: '600' },
  doneBtn: { color: LUCY_COLORS.primary, fontSize: 15, fontWeight: '700' },
  filterRow: { flexDirection: 'row', paddingHorizontal: 20, paddingBottom: 10, gap: 8 },
  filterTab: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 14, backgroundColor: LUCY_COLORS.surfaceRaised, borderWidth: 1, borderColor: 'transparent' },
  filterTabActive: { borderColor: LUCY_COLORS.primary, backgroundColor: LUCY_COLORS.primarySoft },
  filterText: { color: LUCY_COLORS.textSubtle, fontSize: 12, fontWeight: '700', letterSpacing: 0.4 },
  filterTextActive: { color: LUCY_COLORS.primaryGlow },
  list: { flex: 1 },
  separator: { height: 1, backgroundColor: LUCY_COLORS.divider, marginLeft: 68 },
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 20, paddingVertical: 13, position: 'relative' },
  rowUnread: { backgroundColor: '#1F180E' },
  unreadBar: { position: 'absolute', left: 0, top: 13, bottom: 13, width: 3, borderRadius: 2 },
  iconWrap: { width: 40, height: 40, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 12, flexShrink: 0 },
  iconGlyph: { fontSize: 18 },
  content: { flex: 1, gap: 3 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badge: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  badgeText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  expiredLabel: { color: LUCY_COLORS.textSubtle, fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  title: { color: LUCY_COLORS.textMuted, fontSize: 14, fontWeight: '600', lineHeight: 20 },
  titleUnread: { color: LUCY_COLORS.textDark, fontWeight: '700' },
  body: { color: LUCY_COLORS.textSubtle, fontSize: 13, lineHeight: 18 },
  age: { color: LUCY_COLORS.textSubtle, fontSize: 11, marginTop: 1 },
  dismissBtn: { marginLeft: 8, paddingLeft: 4, justifyContent: 'center', paddingTop: 2 },
  dismissIcon: { color: LUCY_COLORS.textSubtle, fontSize: 14, fontWeight: '700' },
  emptyWrap: { alignItems: 'center', padding: 48, gap: 10 },
  emptyIcon: { color: LUCY_COLORS.textSubtle, fontSize: 36 },
  emptyText: { color: LUCY_COLORS.textDark, fontSize: 17, fontWeight: '700' },
  emptySub: { color: LUCY_COLORS.textSubtle, fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
