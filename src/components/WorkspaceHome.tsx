/**
 * WorkspaceHome — the in-app Lumia live-tile command center (Workspace landing). Colorful tiles,
 * each with icon + count + one status line, then full-width Plan My Day + Quick Actions. Tapping a
 * tile opens that section. No tab-heavy layout. (Mirrors the web Workspace home.)
 */
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LUCY_COLORS } from '../config/colors';
import { getDatabase } from '../db';

type WsKey = 'Calendar' | 'Documents' | 'Resources' | 'Projects';

interface Tile { key: string; icon: string; label: string; color: string; count: number; status: string; open: WsKey | 'bookmarks' | 'plan' }

// Secondary sections reachable from a small "More" row (kept tile-first, not tab-heavy).
const MORE: Array<[string, string]> = [
  ['Galaxy', 'Glossary'], ['Meetings', 'Meetings'], ['Listen', 'Listen data'],
  ['People', 'People'], ['Ideas', 'Ideas'], ['Expenses', 'Expenses'],
];

export function WorkspaceHome({ onOpen, onPlanDay }: { onOpen: (tab: string) => void; onPlanDay: () => void }) {
  const [tiles, setTiles] = useState<Tile[] | null>(null);

  const load = useCallback(async () => {
    const db = await getDatabase();
    const now = Date.now();
    const ds = new Date(); ds.setHours(0, 0, 0, 0); const dayStart = ds.getTime(); const dayEnd = dayStart + 86400000;
    const [docs, res, proj, cal, uns] = await Promise.all([
      db.getFirstAsync<{ n: number; b: number }>('SELECT COUNT(*) n, COUNT(DISTINCT bucket) b FROM vault_items').catch(() => null),
      db.getFirstAsync<{ n: number }>('SELECT COUNT(*) n FROM online_resources').catch(() => null),
      db.getFirstAsync<{ n: number }>("SELECT COUNT(*) n FROM projects WHERE status != 'archived'").catch(() => null),
      db.getAllAsync<{ title: string; start_at: number }>("SELECT title, start_at FROM scheduled_blocks WHERE status='committed' AND start_at>=? AND start_at<? ORDER BY start_at", dayStart, dayEnd).catch(() => []),
      import('../scheduling').then((m) => m.unscheduledPendingTodos(db)).catch(() => [] as Array<{ id: number }>),
    ]);
    const nextB = (cal as Array<{ title: string; start_at: number }>).find((b) => b.start_at >= now) || (cal as Array<{ title: string; start_at: number }>)[0];
    const t = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    setTiles([
      { key: 'calendar', icon: '📅', label: 'Calendar', color: '#FF8C42', count: (cal as unknown[]).length, status: nextB ? `Next: ${nextB.title} · ${t(nextB.start_at)}` : 'Nothing today — plan it', open: 'Calendar' },
      { key: 'documents', icon: '📄', label: 'Documents', color: '#4DA3FF', count: docs?.n ?? 0, status: `${docs?.b ?? 0} categories`, open: 'Documents' },
      { key: 'resources', icon: '🌐', label: 'Resources', color: '#34D399', count: res?.n ?? 0, status: (res?.n ?? 0) ? 'links saved' : 'Add your first link', open: 'Resources' },
      { key: 'projects', icon: '📂', label: 'Projects', color: '#A78BFA', count: proj?.n ?? 0, status: (proj?.n ?? 0) ? `${proj?.n} active` : 'Start a project', open: 'Projects' },
      { key: 'bookmarks', icon: '🔖', label: 'Bookmarks', color: '#FB7185', count: 0, status: 'Coming soon', open: 'bookmarks' },
      { key: 'suggested', icon: '✦', label: 'Lucy Suggested', color: '#F5C451', count: (uns as unknown[]).length, status: (uns as unknown[]).length ? `${(uns as unknown[]).length} need a time` : 'All caught up', open: 'plan' },
    ]);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const tap = (tile: Tile) => {
    if (tile.open === 'bookmarks') return;
    if (tile.open === 'plan') { onPlanDay(); return; }
    onOpen(tile.open);
  };

  if (!tiles) return <View style={styles.center}><ActivityIndicator color={LUCY_COLORS.primary} /></View>;

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text style={styles.kicker}>Workspace</Text>
      <Text style={styles.h}>Command center</Text>
      <Text style={styles.sub}>Everything you manage, at a glance.</Text>

      <View style={styles.grid}>
        {tiles.map((t) => (
          <TouchableOpacity key={t.key} activeOpacity={0.85} onPress={() => tap(t)}
            style={[styles.tile, { backgroundColor: t.color + '22', borderColor: t.color + '55' }]}>
            <View style={styles.tileTop}>
              <Text style={styles.tileIcon}>{t.icon}</Text>
              <Text style={styles.tileCount}>{t.count}</Text>
            </View>
            <Text style={styles.tileName}>{t.label}</Text>
            <Text style={styles.tileStatus} numberOfLines={1}>{t.status}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity activeOpacity={0.9} style={styles.planBtn} onPress={onPlanDay}>
        <Text style={styles.planIcon}>✦</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.planT}>Plan My Day</Text>
          <Text style={styles.planD}>Let LUCY schedule your open tasks around your day</Text>
        </View>
        <Text style={styles.planChev}>→</Text>
      </TouchableOpacity>

      <View style={styles.qaBox}>
        <Text style={styles.qaH}>Quick actions</Text>
        <View style={styles.qaGrid}>
          {([['◷', 'Find time', () => onOpen('Calendar')], ['⬆', 'Upload doc', () => onOpen('Documents')], ['🌐', 'Add link', () => onOpen('Resources')], ['📂', 'New project', () => onOpen('Projects')]] as Array<[string, string, () => void]>).map(([ic, label, act]) => (
            <TouchableOpacity key={label} style={styles.qaBtn} onPress={act}>
              <Text style={styles.qaIcon}>{ic}</Text><Text style={styles.qaLabel}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.hint}>Tip: tap the mic and just say what you want — "schedule a 15 min walk at 6:30".</Text>
      </View>

      <Text style={styles.moreH}>More in your workspace</Text>
      <View style={styles.moreRow}>
        {MORE.map(([key, label]) => (
          <TouchableOpacity key={key} style={styles.moreChip} onPress={() => onOpen(key)}>
            <Text style={styles.moreChipT}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  wrap: { padding: 16, paddingBottom: 60 },
  kicker: { color: LUCY_COLORS.textMuted, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' },
  h: { color: LUCY_COLORS.textDark, fontSize: 26, fontWeight: '800', marginTop: 2 },
  sub: { color: LUCY_COLORS.textMuted, fontSize: 13, marginTop: 4, marginBottom: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  tile: { width: '48.5%', borderRadius: 18, borderWidth: 1, padding: 15, minHeight: 118, marginBottom: 13, justifyContent: 'space-between' },
  tileTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tileIcon: { fontSize: 21 },
  tileCount: { color: LUCY_COLORS.textDark, fontSize: 28, fontWeight: '800' },
  tileName: { color: LUCY_COLORS.textDark, fontWeight: '700', fontSize: 15, marginTop: 12 },
  tileStatus: { color: LUCY_COLORS.textMuted, fontSize: 11.5, marginTop: 2 },
  planBtn: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: LUCY_COLORS.primary, borderRadius: 16, padding: 16, marginTop: 4, marginBottom: 14 },
  planIcon: { fontSize: 22, color: '#fff' },
  planT: { color: '#fff', fontWeight: '800', fontSize: 16 },
  planD: { color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 2 },
  planChev: { color: '#fff', fontSize: 20 },
  qaBox: { backgroundColor: LUCY_COLORS.surfaceRaised, borderWidth: 1, borderColor: LUCY_COLORS.border, borderRadius: 16, padding: 16 },
  qaH: { color: LUCY_COLORS.textDark, fontWeight: '700', marginBottom: 12 },
  qaGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10 },
  qaBtn: { width: '47%', flexDirection: 'column', alignItems: 'center', gap: 6, backgroundColor: LUCY_COLORS.background, borderWidth: 1, borderColor: LUCY_COLORS.border, borderRadius: 12, paddingVertical: 14 },
  qaIcon: { fontSize: 18 },
  qaLabel: { color: LUCY_COLORS.textDark, fontSize: 12.5, fontWeight: '600' },
  hint: { color: LUCY_COLORS.textMuted, fontSize: 11.5, marginTop: 14, lineHeight: 16 },
  moreH: { color: LUCY_COLORS.textMuted, fontSize: 12, fontWeight: '600', marginTop: 20, marginBottom: 8 },
  moreRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  moreChip: { borderWidth: 1, borderColor: LUCY_COLORS.border, backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  moreChipT: { color: LUCY_COLORS.textDark, fontSize: 13 },
});
