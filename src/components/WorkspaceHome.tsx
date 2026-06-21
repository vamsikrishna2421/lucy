/**
 * WorkspaceHome - Lumia-style command center for Lucy's workspace.
 * Keeps the existing destinations and data reads; this file is visual/layout only.
 */
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LUCY_COLORS, LUCY_SHADOWS } from '../config/colors';
import { RADIUS } from './ui';
import { getDatabase } from '../db';

type WsKey = 'Calendar' | 'Documents' | 'Resources' | 'Projects';

interface Tile {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
  count: number;
  status: string;
  open: WsKey | 'bookmarks' | 'plan';
  featured?: boolean;
}

interface BrainTile {
  key: string;
  label: string;
  hint: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
}

const BRAIN: BrainTile[] = [
  { key: 'Galaxy', label: 'Glossary', hint: 'Words & meanings you keep', icon: 'planet', color: LUCY_COLORS.violet },
  { key: 'People', label: 'People', hint: 'Who matters to you', icon: 'people', color: LUCY_COLORS.cyan },
  { key: 'Meetings', label: 'Meetings', hint: 'Conversations captured', icon: 'people-circle', color: LUCY_COLORS.teal },
  { key: 'Ideas', label: 'Ideas', hint: 'Sparks worth keeping', icon: 'bulb', color: LUCY_COLORS.gold },
  { key: 'Reminders', label: 'Reminders', hint: 'What to do, and when', icon: 'alarm', color: LUCY_COLORS.primaryGlow },
  { key: 'Gallery', label: 'Scans & photos', hint: 'Every image you captured', icon: 'images', color: LUCY_COLORS.teal },
  { key: 'Medications', label: 'Medications', hint: 'Doses & reminders', icon: 'medkit', color: LUCY_COLORS.rose },
  { key: 'Listen', label: 'Listen data', hint: 'What Lucy has heard', icon: 'mic', color: LUCY_COLORS.rose },
  { key: 'Expenses', label: 'Expenses', hint: 'Money in motion', icon: 'cash', color: LUCY_COLORS.primary },
  { key: 'Goals', label: 'Money goals', hint: 'Save toward a target', icon: 'flag', color: LUCY_COLORS.gold },
];

export function WorkspaceHome({ onOpen, onPlanDay }: { onOpen: (tab: string) => void; onPlanDay: () => void }) {
  const [tiles, setTiles] = useState<Tile[] | null>(null);
  const [brainCounts, setBrainCounts] = useState<Record<string, number>>({});

  // Live counts for the "Brain & knowledge" tiles so the workspace feels alive (best-effort).
  const loadBrainCounts = useCallback(async () => {
    const db = await getDatabase();
    const one = async (sql: string): Promise<number> => {
      try { const r = await db.getFirstAsync<{ n: number }>(sql); return r?.n ?? 0; } catch { return 0; }
    };
    const [people, meetings, ideas, reminders, gallery, meds, expenses] = await Promise.all([
      one('SELECT COUNT(*) n FROM people'),
      one('SELECT COUNT(*) n FROM meeting_summaries'),
      one('SELECT COUNT(*) n FROM ideas'),
      one("SELECT COUNT(*) n FROM reminders WHERE status='pending'"),
      one("SELECT COUNT(*) n FROM captures WHERE source_image_path IS NOT NULL AND source_image_path != ''"),
      one('SELECT COUNT(*) n FROM medications WHERE active = 1'),
      one('SELECT COUNT(*) n FROM expenses'),
    ]);
    setBrainCounts({ People: people, Meetings: meetings, Ideas: ideas, Reminders: reminders, Gallery: gallery, Medications: meds, Expenses: expenses });
  }, []);
  useEffect(() => { void loadBrainCounts(); }, [loadBrainCounts]);

  const load = useCallback(async () => {
    const db = await getDatabase();
    const now = Date.now();
    const ds = new Date();
    ds.setHours(0, 0, 0, 0);
    const dayStart = ds.getTime();
    const dayEnd = dayStart + 86400000;
    const [docs, res, proj, cal, uns] = await Promise.all([
      db.getFirstAsync<{ n: number; b: number }>('SELECT COUNT(*) n, COUNT(DISTINCT bucket) b FROM vault_items').catch(() => null),
      db.getFirstAsync<{ n: number }>('SELECT COUNT(*) n FROM online_resources').catch(() => null),
      db.getFirstAsync<{ n: number }>("SELECT COUNT(*) n FROM projects WHERE status != 'archived'").catch(() => null),
      db.getAllAsync<{ title: string; start_at: number }>("SELECT title, start_at FROM scheduled_blocks WHERE status='committed' AND start_at>=? AND start_at<? ORDER BY start_at", dayStart, dayEnd).catch(() => []),
      import('../scheduling').then((m) => m.unscheduledPendingTodos(db)).catch(() => [] as Array<{ id: number }>),
    ]);
    const todayBlocks = cal as Array<{ title: string; start_at: number }>;
    const nextB = todayBlocks.find((b) => b.start_at >= now) || todayBlocks[0];
    const t = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const looseTasks = uns as unknown[];

    setTiles([
      {
        key: 'calendar',
        icon: 'calendar-clear',
        label: 'Calendar',
        color: LUCY_COLORS.primary,
        count: todayBlocks.length,
        status: nextB ? `Next: ${nextB.title} at ${t(nextB.start_at)}` : 'Open day. Lucy can shape it.',
        open: 'Calendar',
        featured: true,
      },
      {
        key: 'documents',
        icon: 'document-text',
        label: 'Documents',
        color: LUCY_COLORS.cyan,
        count: docs?.n ?? 0,
        status: `${docs?.b ?? 0} categories`,
        open: 'Documents',
      },
      {
        key: 'resources',
        icon: 'globe',
        label: 'Resources',
        color: LUCY_COLORS.teal,
        count: res?.n ?? 0,
        status: (res?.n ?? 0) ? 'Links saved for later' : 'Save the next useful link',
        open: 'Resources',
      },
      {
        key: 'projects',
        icon: 'folder-open',
        label: 'Projects',
        color: LUCY_COLORS.violet,
        count: proj?.n ?? 0,
        status: (proj?.n ?? 0) ? `${proj?.n} active` : 'Give a project a home',
        open: 'Projects',
      },
      {
        key: 'bookmarks',
        icon: 'bookmark',
        label: 'Bookmarks',
        color: LUCY_COLORS.rose,
        count: 0,
        status: 'Waiting quietly',
        open: 'bookmarks',
      },
      {
        key: 'suggested',
        icon: 'sparkles',
        label: 'Lucy Suggested',
        color: LUCY_COLORS.gold,
        count: looseTasks.length,
        status: looseTasks.length ? `${looseTasks.length} need a time` : 'All caught up',
        open: 'plan',
        featured: true,
      },
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
      <View style={styles.hero}>
        <View style={styles.heroGlow} />
        <View style={styles.heroTop}>
          <Text style={styles.kicker}>Workspace</Text>
          <View style={styles.localChip}>
            <View style={styles.localDot} />
            <Text style={styles.localChipText}>On device</Text>
          </View>
        </View>
        <Text style={styles.h}>Command center</Text>
        <Text style={styles.sub}>Calendar, documents, projects, and loose ends gathered into one quiet place.</Text>
      </View>

      <View style={styles.grid}>
        {tiles.map((tile) => (
          <TouchableOpacity
            key={tile.key}
            activeOpacity={0.85}
            onPress={() => tap(tile)}
            style={[styles.tile, tile.featured && styles.tileFeatured]}
          >
            {tile.featured ? <View style={[styles.tileAccent, { backgroundColor: tile.color }]} /> : null}
            <View style={styles.tileTop}>
              <View style={[styles.tileIconWrap, { backgroundColor: `${tile.color}1A`, borderColor: `${tile.color}33` }]}>
                <Ionicons name={tile.icon} size={20} color={tile.color} />
              </View>
              <Text style={[styles.tileCount, { color: tile.color }]}>{tile.count}</Text>
            </View>
            <View>
              <Text style={styles.tileName}>{tile.label}</Text>
              <Text style={styles.tileStatus} numberOfLines={2}>{tile.status}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity activeOpacity={0.9} style={styles.planBtn} onPress={onPlanDay}>
        <View style={styles.planIcon}>
          <Ionicons name="sparkles" size={22} color={LUCY_COLORS.white} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.planT}>Plan My Day</Text>
          <Text style={styles.planD}>Let Lucy place open tasks around what is already true.</Text>
        </View>
        <Ionicons name="arrow-forward" size={19} color={LUCY_COLORS.white} />
      </TouchableOpacity>

      <View style={styles.qaBox}>
        <View style={styles.qaHead}>
          <Text style={styles.qaH}>Quick actions</Text>
          <Text style={styles.qaSub}>Start from intent</Text>
        </View>
        <View style={styles.qaGrid}>
          {([
            ['time-outline', 'Find time', () => onOpen('Calendar')],
            ['cloud-upload-outline', 'Upload doc', () => onOpen('Documents')],
            ['link-outline', 'Add link', () => onOpen('Resources')],
            ['add-circle-outline', 'New project', () => onOpen('Projects')],
          ] as Array<[keyof typeof Ionicons.glyphMap, string, () => void]>).map(([icon, label, action]) => (
            <TouchableOpacity key={label} style={styles.qaBtn} onPress={action}>
              <Ionicons name={icon} size={18} color={LUCY_COLORS.primaryGlow} />
              <Text style={styles.qaLabel}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <Text style={styles.moreH}>Brain & knowledge</Text>
      <View style={styles.grid}>
        {BRAIN.map((b) => (
          <TouchableOpacity
            key={b.key}
            activeOpacity={0.85}
            onPress={() => onOpen(b.key)}
            style={styles.brainTile}
          >
            <View style={[styles.brainIconWrap, { backgroundColor: `${b.color}1A`, borderColor: `${b.color}33` }]}>
              <Ionicons name={b.icon} size={18} color={b.color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.brainName}>{b.label}{typeof brainCounts[b.key] === 'number' && brainCounts[b.key] > 0 ? <Text style={[styles.brainCount, { color: b.color }]}>  {brainCounts[b.key]}</Text> : null}</Text>
              <Text style={styles.brainHint} numberOfLines={1}>{b.hint}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  wrap: { padding: 14, paddingBottom: 72 },
  hero: { position: 'relative', overflow: 'hidden', backgroundColor: LUCY_COLORS.surface, borderWidth: 1, borderColor: LUCY_COLORS.border, borderRadius: RADIUS.card, padding: 18, marginBottom: 14, ...LUCY_SHADOWS.md },
  heroGlow: { position: 'absolute', right: -55, top: -65, width: 170, height: 170, borderRadius: 85, backgroundColor: LUCY_COLORS.primarySoft },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  kicker: { color: LUCY_COLORS.primary, fontSize: 11, letterSpacing: 1.2, fontWeight: '900', textTransform: 'uppercase' },
  h: { color: LUCY_COLORS.textDark, fontSize: 28, fontWeight: '900', marginTop: 2, lineHeight: 34 },
  sub: { color: LUCY_COLORS.textMuted, fontSize: 13, marginTop: 7, lineHeight: 19, maxWidth: 310 },
  localChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: RADIUS.pill, backgroundColor: LUCY_COLORS.surfaceRaised, borderWidth: 1, borderColor: LUCY_COLORS.border },
  localDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: LUCY_COLORS.teal },
  localChipText: { color: LUCY_COLORS.textMuted, fontSize: 11, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  // Lumia-style tile: clean white card, tinted icon ring, big colored count
  tile: { position: 'relative', overflow: 'hidden', width: '48.5%', backgroundColor: LUCY_COLORS.surface, borderRadius: RADIUS.card, borderWidth: 1, borderColor: LUCY_COLORS.border, padding: 15, minHeight: 132, marginBottom: 12, justifyContent: 'space-between', ...LUCY_SHADOWS.md },
  tileFeatured: { minHeight: 150 },
  tileAccent: { position: 'absolute', top: 0, left: 0, right: 0, height: 3 },
  tileTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tileIconWrap: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  tileCount: { fontSize: 30, fontWeight: '900', lineHeight: 34 },
  tileName: { color: LUCY_COLORS.textDark, fontWeight: '800', fontSize: 15, marginTop: 12 },
  tileStatus: { color: LUCY_COLORS.textMuted, fontSize: 11.5, marginTop: 4, lineHeight: 16 },
  planBtn: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: LUCY_COLORS.primary, borderRadius: RADIUS.card, padding: 16, marginTop: 2, marginBottom: 14, ...LUCY_SHADOWS.glow },
  planIcon: { width: 40, height: 40, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  planT: { color: LUCY_COLORS.white, fontWeight: '800', fontSize: 16 },
  planD: { color: 'rgba(255,255,255,0.86)', fontSize: 12, marginTop: 3, lineHeight: 17 },
  qaBox: { backgroundColor: LUCY_COLORS.surface, borderWidth: 1, borderColor: LUCY_COLORS.border, borderRadius: RADIUS.card, padding: 16, ...LUCY_SHADOWS.md },
  qaHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 },
  qaH: { color: LUCY_COLORS.textDark, fontWeight: '800', fontSize: 15 },
  qaSub: { color: LUCY_COLORS.textSubtle, fontSize: 11, fontWeight: '700' },
  qaGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10 },
  qaBtn: { width: '47%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: LUCY_COLORS.surfaceRaised, borderWidth: 1, borderColor: LUCY_COLORS.border, borderRadius: RADIUS.control, paddingVertical: 13, paddingHorizontal: 8 },
  qaLabel: { color: LUCY_COLORS.textDark, fontSize: 12.5, fontWeight: '700' },
  moreH: { color: LUCY_COLORS.textDark, fontSize: 18, fontWeight: '800', marginTop: 22, marginBottom: 12 },
  brainTile: { width: '48.5%', minHeight: 80, backgroundColor: LUCY_COLORS.surface, borderRadius: RADIUS.control, borderWidth: 1, borderColor: LUCY_COLORS.border, padding: 13, marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 11, ...LUCY_SHADOWS.sm },
  brainIconWrap: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  brainName: { color: LUCY_COLORS.textDark, fontWeight: '800', fontSize: 14 },
  brainCount: { fontWeight: '900', fontSize: 13 },
  brainHint: { color: LUCY_COLORS.textMuted, fontSize: 11, marginTop: 3, lineHeight: 15 },
});
