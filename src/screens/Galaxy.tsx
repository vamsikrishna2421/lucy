/**
 * Brain Galaxy — hierarchical topic tree browser.
 *
 * Navigation: Home → Life Areas → Topics → Sub-topics → Items
 * Uses a simple in-component stack (no navigator required).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, Animated, Easing, FlatList, Modal, Pressable,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { LUCY_COLORS } from '../config/colors';
import { getDatabase } from '../db';
import {
  archiveTopic, insertTopic, listChildTopics, listItemsInSubtree,
  moveTopicItem, renameTopic, type BrainTopicRow,
} from '../db/brainTopics';
import { haptic } from '../config/haptics';
import { StoryView, type StorySubject } from './StoryView';
import { MemoryDetailSheet } from '../components/MemoryDetailSheet';

// ─── Stack ────────────────────────────────────────────────────────────────────

type GalaxyFrame =
  | { kind: 'home' }
  | { kind: 'topic'; topicId: number; name: string; breadcrumb: string };

// ─── Life-area colour palette ─────────────────────────────────────────────────

const AREA_COLORS = [
  '#FF8C42', '#4ADE80', '#60A5FA', '#C084FC',
  '#F59E0B', '#FB7185', '#2DD4BF', '#FFA05C',
];

function areaColor(index: number): string {
  return AREA_COLORS[index % AREA_COLORS.length];
}

// ─── Seeding modal ────────────────────────────────────────────────────────────

function SeedingModal({
  proposedJson,
  onAccept,
  onDismiss,
}: {
  proposedJson: string;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  let areas: Array<{ name: string; emoji?: string; topics?: Array<{ name: string }> }> = [];
  try {
    const p = JSON.parse(proposedJson) as typeof areas extends infer T ? { areas?: T } : never;
    areas = (p as { areas?: typeof areas }).areas ?? [];
  } catch { /* show empty */ }

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onDismiss}>
      <Pressable style={styles.modalBackdrop} onPress={onDismiss}>
        <Pressable style={styles.modalSheet}>
          <Text style={styles.seedTitle}>Your brain, organised</Text>
          <Text style={styles.seedSub}>
            LUCY found these areas in your captures. Approve to build your Galaxy.
          </Text>
          <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
            {areas.map((area, i) => (
              <View key={i} style={[styles.seedArea, { borderLeftColor: areaColor(i) }]}>
                <Text style={styles.seedAreaName}>{area.emoji} {area.name}</Text>
                {(area.topics ?? []).map((t, j) => (
                  <Text key={j} style={styles.seedTopicChip}>{t.name}</Text>
                ))}
              </View>
            ))}
          </ScrollView>
          <TouchableOpacity style={styles.seedAcceptBtn} onPress={() => { haptic.capture(); onAccept(); }}>
            <Text style={styles.seedAcceptText}>Looks good →</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onDismiss} style={{ paddingVertical: 10, alignItems: 'center' }}>
            <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 13 }}>Not now</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Item card inside a topic ─────────────────────────────────────────────────

interface ItemDisplay {
  table_name: string;
  row_id: number;
  label: string;
  subtitle?: string;
}

function useTopicItems(topicId: number) {
  const [items, setItems] = useState<ItemDisplay[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const db = await getDatabase();
      const rows = await listItemsInSubtree(db, topicId, undefined, 40);
      const ids = rows.reduce<Record<string, number[]>>((acc, r) => {
        (acc[r.table_name] = acc[r.table_name] ?? []).push(r.row_id);
        return acc;
      }, {});
      const display: ItemDisplay[] = [];
      for (const [table, rowIds] of Object.entries(ids)) {
        if (rowIds.length === 0) continue;
        const placeholders = rowIds.map(() => '?').join(',');
        if (table === 'captures') {
          const caps = await db.getAllAsync<{ id: number; extracted_title: string | null; raw_transcript: string }>(
            `SELECT id, extracted_title, raw_transcript FROM captures WHERE id IN (${placeholders}) ORDER BY created_at DESC`,
            ...rowIds,
          );
          caps.forEach((c) => display.push({
            table_name: 'captures', row_id: c.id,
            label: c.extracted_title ?? c.raw_transcript.slice(0, 60),
          }));
        } else if (table === 'todos') {
          const t = await db.getAllAsync<{ id: number; task: string; urgency: string }>(
            `SELECT id, task, urgency FROM todos WHERE id IN (${placeholders})`, ...rowIds,
          );
          t.forEach((r) => display.push({ table_name: 'todos', row_id: r.id, label: r.task, subtitle: r.urgency }));
        } else if (table === 'ideas') {
          const t = await db.getAllAsync<{ id: number; title: string; description: string }>(
            `SELECT id, title, description FROM ideas WHERE id IN (${placeholders})`, ...rowIds,
          );
          t.forEach((r) => display.push({ table_name: 'ideas', row_id: r.id, label: r.title, subtitle: r.description.slice(0, 80) }));
        }
      }
      setItems(display);
    } catch { /* non-critical */ }
    setLoading(false);
  }, [topicId]);

  useEffect(() => { void load(); }, [load]);

  return { items, loading, reload: load };
}

// ─── Main Galaxy view ─────────────────────────────────────────────────────────

export function GalaxyView() {
  const [stack, setStack] = useState<GalaxyFrame[]>([{ kind: 'home' }]);
  const [roots, setRoots] = useState<BrainTopicRow[]>([]);
  const [children, setChildren] = useState<BrainTopicRow[]>([]);
  const [seedingJson, setSeedingJson] = useState<string | null>(null);
  const [showSeed, setShowSeed] = useState(false);
  const [addingTopic, setAddingTopic] = useState(false);
  const [newTopicName, setNewTopicName] = useState('');
  const [storySubject, setStorySubject] = useState<StorySubject | null>(null);

  const current = stack[stack.length - 1];
  const push = (frame: GalaxyFrame) => { haptic.tab(); setStack((s) => [...s, frame]); };
  const pop = () => { haptic.tab(); setStack((s) => s.slice(0, -1)); };

  // Fade-in animation on stack change
  const fadeAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    fadeAnim.setValue(0);
    Animated.timing(fadeAnim, { toValue: 1, duration: 200, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [stack.length]);

  useEffect(() => { void loadCurrentLevel(); }, [current]);

  const loadCurrentLevel = async () => {
    const db = await getDatabase();
    if (current.kind === 'home') {
      setRoots(await listChildTopics(db, null));
      // Check if seeding should be offered
      const { shouldSeedBrainGalaxy, generateSeedProposal } = await import('../processing/brainClassify');
      if (await shouldSeedBrainGalaxy(db)) {
        const proposal = await generateSeedProposal(db);
        if (proposal) { setSeedingJson(proposal); setShowSeed(true); }
      }
    } else {
      setChildren(await listChildTopics(db, current.topicId));
    }
  };

  const handleAcceptSeed = async () => {
    if (!seedingJson) return;
    const db = await getDatabase();
    const { acceptSeedProposal } = await import('../processing/brainClassify');
    await acceptSeedProposal(db, seedingJson);
    setShowSeed(false);
    void loadCurrentLevel();
  };

  const handleAddTopic = async () => {
    const name = newTopicName.trim();
    if (!name) return;
    haptic.capture();
    const db = await getDatabase();
    const parentId = current.kind === 'home' ? null : current.topicId;
    await insertTopic(db, name, parentId);
    setNewTopicName('');
    setAddingTopic(false);
    void loadCurrentLevel();
  };

  const handleLongPressTopic = (t: BrainTopicRow) => {
    haptic.longPress();
    Alert.alert(t.name, 'What do you want to do?', [
      { text: 'Rename', onPress: () => {
        Alert.prompt('Rename topic', '', async (newName) => {
          if (newName?.trim()) {
            const db = await getDatabase();
            await renameTopic(db, t.id, newName.trim());
            void loadCurrentLevel();
          }
        }, 'plain-text', t.name);
      }},
      { text: 'Delete', style: 'destructive', onPress: () => {
        Alert.alert('Delete topic?', 'Items will be moved to Misc.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: async () => {
            haptic.destructive();
            const db = await getDatabase();
            await archiveTopic(db, t.id);
            void loadCurrentLevel();
          }},
        ]);
      }},
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  // ─── Render home (life areas) ──────────────────────────────────────────────

  if (current.kind === 'home') {
    return (
      <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
        {showSeed && seedingJson ? (
          <SeedingModal
            proposedJson={seedingJson}
            onAccept={() => void handleAcceptSeed()}
            onDismiss={() => setShowSeed(false)}
          />
        ) : null}
        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          {roots.length === 0 ? (
            <View style={styles.emptyWrap}>
              <View style={styles.amberPulse}>
                <View style={styles.amberRing3} /><View style={styles.amberRing2} />
                <View style={styles.amberRing1} /><View style={styles.amberDot} />
              </View>
              <Text style={styles.emptyTitle}>Your galaxy is forming</Text>
              <Text style={styles.emptySub}>LUCY will propose your life areas once you've captured 30+ thoughts. Or add one manually.</Text>
            </View>
          ) : (
            <View style={styles.areaGrid}>
              {roots.map((t, i) => (
                <TouchableOpacity
                  key={t.id}
                  style={[styles.areaCard, { borderColor: areaColor(i) + '55' }]}
                  onPress={() => push({ kind: 'topic', topicId: t.id, name: t.name, breadcrumb: t.name })}
                  onLongPress={() => handleLongPressTopic(t)}
                  activeOpacity={0.75}
                >
                  <View style={[styles.areaAccent, { backgroundColor: areaColor(i) }]} />
                  <Text style={styles.areaEmoji}>{t.emoji ?? '◆'}</Text>
                  <Text style={styles.areaName} numberOfLines={2}>{t.name}</Text>
                  <Text style={styles.areaCount}>{t.item_count > 0 ? `${t.item_count}` : '—'}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Add life area */}
          {addingTopic ? (
            <View style={styles.addRow}>
              <TextInput
                style={styles.addInput}
                placeholder="Life area name…"
                placeholderTextColor={LUCY_COLORS.textSubtle}
                value={newTopicName}
                onChangeText={setNewTopicName}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={() => void handleAddTopic()}
              />
              <TouchableOpacity onPress={() => void handleAddTopic()} style={styles.addBtn}>
                <Text style={{ color: '#fff', fontWeight: '800' }}>+</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setAddingTopic(false)} style={{ paddingHorizontal: 10 }}>
                <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 14 }}>✕</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.addAreaBtn} onPress={() => setAddingTopic(true)}>
              <Text style={styles.addAreaText}>+ Add life area</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </Animated.View>
    );
  }

  // ─── Render topic level (sub-topics + items) ───────────────────────────────

  return (
    <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
      {/* Breadcrumb back button */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: 16 }}>
        <TouchableOpacity style={styles.backRow} onPress={pop}>
          <Text style={styles.backChevron}>‹</Text>
          <Text style={styles.backLabel}>{stack.length > 2 ? stack[stack.length - 2]?.kind === 'topic' ? (stack[stack.length - 2] as { name: string }).name : 'Galaxy' : 'Galaxy'}</Text>
        </TouchableOpacity>
        {/* "View story" — opens StoryView for this topic name */}
        <TouchableOpacity
          onPress={() => setStorySubject({ kind: 'topic', name: current.kind === 'topic' ? current.name : '', emoji: '◆' })}
          style={{ paddingVertical: 6, paddingHorizontal: 10, backgroundColor: LUCY_COLORS.primarySoft, borderRadius: 10 }}
        >
          <Text style={{ color: LUCY_COLORS.primary, fontSize: 11, fontWeight: '700' }}>View story ›</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={[...children]}
        keyExtractor={(item) => `t-${item.id}`}
        style={styles.content}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          children.length > 0 ? (
            <Text style={styles.sectionLabel}>SUB-TOPICS</Text>
          ) : null
        }
        renderItem={({ item: t }) => (
          <TouchableOpacity
            style={styles.topicRow}
            onPress={() => push({ kind: 'topic', topicId: t.id, name: t.name, breadcrumb: `${current.name} / ${t.name}` })}
            onLongPress={() => handleLongPressTopic(t)}
            activeOpacity={0.75}
          >
            <Text style={styles.topicEmoji}>{t.emoji ?? '◈'}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.topicName}>{t.name}</Text>
              {t.item_count > 0 ? <Text style={styles.topicCount}>{t.item_count} item{t.item_count !== 1 ? 's' : ''}</Text> : null}
            </View>
            <Text style={styles.topicChevron}>›</Text>
          </TouchableOpacity>
        )}
        ListFooterComponent={<TopicItemList topicId={current.topicId} onOpenStory={setStorySubject} />}
      />

      {/* Add sub-topic */}
      <View style={styles.addBarRow}>
        {addingTopic ? (
          <>
            <TextInput
              style={[styles.addInput, { flex: 1 }]}
              placeholder="Sub-topic name…"
              placeholderTextColor={LUCY_COLORS.textSubtle}
              value={newTopicName}
              onChangeText={setNewTopicName}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={() => void handleAddTopic()}
            />
            <TouchableOpacity onPress={() => void handleAddTopic()} style={styles.addBtn}>
              <Text style={{ color: '#fff', fontWeight: '800' }}>+</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setAddingTopic(false)} style={{ paddingHorizontal: 10 }}>
              <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 14 }}>✕</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity style={styles.addAreaBtn} onPress={() => setAddingTopic(true)}>
            <Text style={styles.addAreaText}>+ Add sub-topic</Text>
          </TouchableOpacity>
        )}
      </View>
      <StoryView subject={storySubject} visible={storySubject !== null} onClose={() => setStorySubject(null)} />
    </Animated.View>
  );
}

// ─── Items list inside a topic ────────────────────────────────────────────────

function TopicItemList({ topicId, onOpenStory }: { topicId: number; onOpenStory: (s: StorySubject) => void }) {
  const { items, loading, reload } = useTopicItems(topicId);
  const [selectedCaptureId, setSelectedCaptureId] = useState<number | null>(null);

  // Long-press a leaf item → confirm + delete the bad capture/task/idea.
  const handleLongPressItem = (item: ItemDisplay) => {
    haptic.longPress();
    const niceType = item.table_name === 'captures' ? 'memory' : item.table_name === 'todos' ? 'task' : 'idea';
    Alert.alert(
      `Delete this ${niceType}?`,
      item.label.slice(0, 120),
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: async () => {
          haptic.destructive();
          try {
            const db = await getDatabase();
            if (item.table_name === 'captures') {
              const { deleteCaptureCompletely } = await import('../db/captures');
              await deleteCaptureCompletely(db, item.row_id);
            } else if (item.table_name === 'todos') {
              const { deleteTodo } = await import('../db/todos');
              await deleteTodo(db, item.row_id);
            } else if (item.table_name === 'ideas') {
              const { deleteIdea } = await import('../db/ideas');
              await deleteIdea(db, item.row_id);
            }
          } catch { /* non-critical */ }
          void reload();
        }},
      ],
    );
  };

  if (loading) return <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 12, padding: 16 }}>Loading…</Text>;
  if (items.length === 0) return null;
  return (
    <View>
      <Text style={[styles.sectionLabel, { marginTop: 16 }]}>ITEMS</Text>
      <Text style={styles.itemsHint}>Tap to open · long-press to delete</Text>
      {items.map((item) => (
        <TouchableOpacity
          key={`${item.table_name}-${item.row_id}`}
          style={styles.itemRow}
          activeOpacity={item.table_name === 'captures' ? 0.75 : 1}
          onPress={() => {
            // Tapping a captured memory opens its detail (summary + LUCY insight + ask).
            if (item.table_name === 'captures') setSelectedCaptureId(item.row_id);
          }}
          onLongPress={() => handleLongPressItem(item)}
          delayLongPress={350}
        >
          <Text style={styles.itemTableBadge}>{item.table_name.toUpperCase()}</Text>
          <Text style={styles.itemLabel} numberOfLines={2}>{item.label}</Text>
          {item.subtitle ? <Text style={styles.itemSub} numberOfLines={1}>{item.subtitle}</Text> : null}
        </TouchableOpacity>
      ))}
      <MemoryDetailSheet
        captureId={selectedCaptureId}
        visible={selectedCaptureId !== null}
        onClose={() => setSelectedCaptureId(null)}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  content: { flex: 1 },
  emptyWrap: { alignItems: 'center', paddingVertical: 60, paddingHorizontal: 40, gap: 14 },
  amberPulse: { alignItems: 'center', justifyContent: 'center', width: 80, height: 80, marginBottom: 4 },
  amberRing3: { position: 'absolute', width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(255,140,66,0.06)' },
  amberRing2: { position: 'absolute', width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(255,140,66,0.10)' },
  amberRing1: { position: 'absolute', width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,140,66,0.16)' },
  amberDot:  { width: 8, height: 8, borderRadius: 4, backgroundColor: LUCY_COLORS.primary },
  emptyTitle: { color: LUCY_COLORS.textDark, fontSize: 17, fontWeight: '700', textAlign: 'center' },
  emptySub: { color: LUCY_COLORS.textMuted, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  // Area grid (2-col)
  areaGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: 12, gap: 10 },
  areaCard: { width: '47%', backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 18, borderWidth: 1, padding: 16, gap: 6, overflow: 'hidden', position: 'relative', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 5, elevation: 4 },
  areaAccent: { position: 'absolute', top: 0, left: 0, right: 0, height: 3, borderTopLeftRadius: 18, borderTopRightRadius: 18 },
  areaEmoji: { fontSize: 28, marginTop: 4 },
  areaName: { color: LUCY_COLORS.textDark, fontSize: 15, fontWeight: '700', lineHeight: 20 },
  areaCount: { color: LUCY_COLORS.textSubtle, fontSize: 11, fontWeight: '600' },
  // Breadcrumb
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 10 },
  backChevron: { color: LUCY_COLORS.primary, fontSize: 22, fontWeight: '600', lineHeight: 26, marginTop: -2 },
  backLabel: { color: LUCY_COLORS.textMuted, fontSize: 14, fontWeight: '600' },
  sectionLabel: { color: LUCY_COLORS.textSubtle, fontSize: 10, fontWeight: '800', letterSpacing: 1.4, marginHorizontal: 16, marginBottom: 8, marginTop: 8 },
  // Sub-topic rows
  topicRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14, backgroundColor: LUCY_COLORS.surfaceRaised, marginHorizontal: 12, marginBottom: 8, borderRadius: 14, borderWidth: 1, borderColor: LUCY_COLORS.border },
  topicEmoji: { fontSize: 22, width: 32, textAlign: 'center' },
  topicName: { color: LUCY_COLORS.textDark, fontSize: 15, fontWeight: '700' },
  topicCount: { color: LUCY_COLORS.textSubtle, fontSize: 11, marginTop: 2 },
  topicChevron: { color: LUCY_COLORS.textSubtle, fontSize: 18, fontWeight: '600' },
  // Items
  itemsHint: { color: LUCY_COLORS.textSubtle, fontSize: 11, marginHorizontal: 16, marginTop: -4, marginBottom: 8 },
  itemRow: { marginHorizontal: 12, marginBottom: 8, backgroundColor: LUCY_COLORS.surface, borderRadius: 12, padding: 12, gap: 4, borderWidth: 1, borderColor: LUCY_COLORS.border },
  itemTableBadge: { color: LUCY_COLORS.textSubtle, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  itemLabel: { color: LUCY_COLORS.textDark, fontSize: 14, fontWeight: '600' },
  itemSub: { color: LUCY_COLORS.textMuted, fontSize: 12 },
  // Add controls
  addAreaBtn: { margin: 12, paddingVertical: 12, alignItems: 'center', borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: LUCY_COLORS.border },
  addAreaText: { color: LUCY_COLORS.textSubtle, fontSize: 13, fontWeight: '600' },
  addRow: { flexDirection: 'row', alignItems: 'center', margin: 12, gap: 8 },
  addBarRow: { borderTopWidth: 1, borderTopColor: LUCY_COLORS.border, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center' },
  addInput: { backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, color: LUCY_COLORS.textDark, fontSize: 14, borderWidth: 1, borderColor: LUCY_COLORS.border },
  addBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: LUCY_COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  // Seeding modal
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: LUCY_COLORS.surfaceRaised, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 16, borderTopWidth: 1, borderColor: LUCY_COLORS.border },
  seedTitle: { color: LUCY_COLORS.textDark, fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  seedSub: { color: LUCY_COLORS.textMuted, fontSize: 14, lineHeight: 21 },
  seedArea: { borderLeftWidth: 3, paddingLeft: 12, marginBottom: 12, gap: 4 },
  seedAreaName: { color: LUCY_COLORS.textDark, fontSize: 15, fontWeight: '700' },
  seedTopicChip: { color: LUCY_COLORS.textSubtle, fontSize: 12 },
  seedAcceptBtn: { backgroundColor: LUCY_COLORS.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  seedAcceptText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
