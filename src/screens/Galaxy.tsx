/**
 * Brain Galaxy — hierarchical topic tree browser.
 *
 * Navigation: Home → Life Areas → Topics → Sub-topics → Items
 * Uses a simple in-component stack (no navigator required).
 *
 * Visual: LIGHT + INDIGO system — white radius-22 cards, soft neutral shadow, tinted icon rings + pills,
 * crisp near-black hierarchy (see docs/LUCY_DESIGN_SYSTEM.md). Logic/data/handlers are unchanged.
 */

import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, Animated, Easing, FlatList, Modal, Pressable,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { LUCY_COLORS, LUCY_SHADOWS } from '../config/colors';
import { Pill, RADIUS } from '../components/ui';
import { LucyEmptyState } from '../components/LucyEmptyState';
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

// ─── Life-area colour palette (token accents, multi-color on light) ─────────────

const AREA_COLORS = [
  LUCY_COLORS.primary, LUCY_COLORS.teal, LUCY_COLORS.info, LUCY_COLORS.violet,
  LUCY_COLORS.gold, LUCY_COLORS.rose, LUCY_COLORS.cyan, LUCY_COLORS.primaryGlow,
];

function areaColor(index: number): string {
  return AREA_COLORS[index % AREA_COLORS.length];
}

// A small per-item meaning chip (color = source/category).
function itemTypeMeta(table: string): { label: string; color: string; icon: keyof typeof Ionicons.glyphMap } {
  switch (table) {
    case 'todos': return { label: 'Task', color: LUCY_COLORS.info, icon: 'checkmark-circle' };
    case 'ideas': return { label: 'Idea', color: LUCY_COLORS.gold, icon: 'bulb' };
    case 'captures': return { label: 'Memory', color: LUCY_COLORS.violet, icon: 'sparkles' };
    default: return { label: table, color: LUCY_COLORS.textSubtle, icon: 'ellipse' };
  }
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
          <View style={styles.grip} />
          <Text style={styles.seedEyebrow}>Proposed from your captures</Text>
          <Text style={styles.seedTitle}>Your brain, organised</Text>
          <Text style={styles.seedSub}>
            LUCY found these areas in your captures. Approve to build your Galaxy.
          </Text>
          <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
            {areas.map((area, i) => (
              <View key={i} style={styles.seedArea}>
                <View style={styles.seedAreaHead}>
                  <View style={[styles.seedAreaDot, { backgroundColor: areaColor(i) }]} />
                  <Text style={styles.seedAreaName}>{area.emoji ? `${area.emoji} ` : ''}{area.name}</Text>
                </View>
                <View style={styles.seedChipWrap}>
                  {(area.topics ?? []).map((t, j) => (
                    <View key={j} style={styles.seedTopicChip}>
                      <Text style={styles.seedTopicChipText}>{t.name}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ))}
          </ScrollView>
          <TouchableOpacity style={styles.seedAcceptBtn} activeOpacity={0.85} onPress={() => { haptic.capture(); onAccept(); }}>
            <Ionicons name="checkmark" size={18} color={LUCY_COLORS.white} style={{ marginRight: 8 }} />
            <Text style={styles.seedAcceptText}>Looks good</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onDismiss} style={{ paddingVertical: 12, alignItems: 'center' }}>
            <Text style={styles.seedDismiss}>Not now</Text>
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
        <ScrollView style={styles.content} contentContainerStyle={styles.contentPad} showsVerticalScrollIndicator={false}>
          {roots.length === 0 ? (
            <LucyEmptyState
              title="Your galaxy is forming"
              message="LUCY will propose your life areas once you've captured 30+ thoughts. Or add one manually below."
            />
          ) : (
            <View style={styles.areaGrid}>
              {roots.map((t, i) => {
                const color = areaColor(i);
                return (
                  <TouchableOpacity
                    key={t.id}
                    style={styles.areaCard}
                    onPress={() => push({ kind: 'topic', topicId: t.id, name: t.name, breadcrumb: t.name })}
                    onLongPress={() => handleLongPressTopic(t)}
                    activeOpacity={0.85}
                  >
                    <View style={styles.areaTop}>
                      <View style={[styles.areaIconRing, { backgroundColor: color + '1A', borderColor: color + '33' }]}>
                        <Text style={[styles.areaEmoji, { color }]}>{t.emoji ?? '◆'}</Text>
                      </View>
                      <Text style={styles.areaCount}>{t.item_count > 0 ? `${t.item_count}` : '—'}</Text>
                    </View>
                    <Text style={styles.areaName} numberOfLines={2}>{t.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* Add life area */}
          {addingTopic ? (
            <View style={styles.addRow}>
              <TextInput
                style={styles.addInput}
                placeholder="Life area name…"
                placeholderTextColor={LUCY_COLORS.textFaint}
                value={newTopicName}
                onChangeText={setNewTopicName}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={() => void handleAddTopic()}
              />
              <TouchableOpacity onPress={() => void handleAddTopic()} style={styles.addBtn}>
                <Ionicons name="add" size={22} color={LUCY_COLORS.white} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setAddingTopic(false)} style={styles.addCancel} hitSlop={8}>
                <Ionicons name="close" size={18} color={LUCY_COLORS.textSubtle} />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.addAreaBtn} activeOpacity={0.8} onPress={() => setAddingTopic(true)}>
              <Ionicons name="add" size={18} color={LUCY_COLORS.primary} />
              <Text style={styles.addAreaText}>Add life area</Text>
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
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backRow} onPress={pop} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={20} color={LUCY_COLORS.primary} />
          <Text style={styles.backLabel}>{stack.length > 2 ? stack[stack.length - 2]?.kind === 'topic' ? (stack[stack.length - 2] as { name: string }).name : 'Galaxy' : 'Galaxy'}</Text>
        </TouchableOpacity>
        {/* "View story" — opens StoryView for this topic name */}
        <TouchableOpacity
          onPress={() => setStorySubject({ kind: 'topic', name: current.kind === 'topic' ? current.name : '', emoji: '◆' })}
          style={styles.storyBtn}
          activeOpacity={0.8}
        >
          <Ionicons name="book-outline" size={13} color={LUCY_COLORS.primary} style={{ marginRight: 5 }} />
          <Text style={styles.storyBtnText}>View story</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={[...children]}
        keyExtractor={(item) => `t-${item.id}`}
        style={styles.content}
        contentContainerStyle={styles.listPad}
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
            activeOpacity={0.85}
          >
            <View style={styles.topicIconRing}>
              <Text style={styles.topicEmoji}>{t.emoji ?? '◈'}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.topicName}>{t.name}</Text>
              {t.item_count > 0 ? <Text style={styles.topicCount}>{t.item_count} item{t.item_count !== 1 ? 's' : ''}</Text> : null}
            </View>
            <Ionicons name="chevron-forward" size={18} color={LUCY_COLORS.textFaint} />
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
              placeholderTextColor={LUCY_COLORS.textFaint}
              value={newTopicName}
              onChangeText={setNewTopicName}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={() => void handleAddTopic()}
            />
            <TouchableOpacity onPress={() => void handleAddTopic()} style={styles.addBtn}>
              <Ionicons name="add" size={22} color={LUCY_COLORS.white} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setAddingTopic(false)} style={styles.addCancel} hitSlop={8}>
              <Ionicons name="close" size={18} color={LUCY_COLORS.textSubtle} />
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity style={styles.addAreaBtn} activeOpacity={0.8} onPress={() => setAddingTopic(true)}>
            <Ionicons name="add" size={18} color={LUCY_COLORS.primary} />
            <Text style={styles.addAreaText}>Add sub-topic</Text>
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

  if (loading) return (
    <View style={styles.loadingRow}>
      <Text style={styles.loadingText}>Loading…</Text>
    </View>
  );
  if (items.length === 0) return null;
  return (
    <View>
      <Text style={[styles.sectionLabel, { marginTop: 20 }]}>ITEMS</Text>
      <Text style={styles.itemsHint}>Tap to open · long-press to delete</Text>
      {items.map((item) => {
        const meta = itemTypeMeta(item.table_name);
        return (
          <TouchableOpacity
            key={`${item.table_name}-${item.row_id}`}
            style={styles.itemRow}
            activeOpacity={item.table_name === 'captures' ? 0.85 : 1}
            onPress={() => {
              // Tapping a captured memory opens its detail (summary + LUCY insight + ask).
              if (item.table_name === 'captures') setSelectedCaptureId(item.row_id);
            }}
            onLongPress={() => handleLongPressItem(item)}
            delayLongPress={350}
          >
            <Pill label={meta.label} color={meta.color} icon={meta.icon} />
            <Text style={styles.itemLabel} numberOfLines={2}>{item.label}</Text>
            {item.subtitle ? <Text style={styles.itemSub} numberOfLines={1}>{item.subtitle}</Text> : null}
          </TouchableOpacity>
        );
      })}
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
  contentPad: { padding: 14, paddingBottom: 40 },
  listPad: { paddingHorizontal: 14, paddingBottom: 40 },
  // Area grid (2-col) — clean white tiles
  areaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between' },
  areaCard: { width: '48%', backgroundColor: LUCY_COLORS.surface, borderRadius: RADIUS.card, borderWidth: 1, borderColor: LUCY_COLORS.border, padding: 16, gap: 14, minHeight: 124, justifyContent: 'space-between', ...LUCY_SHADOWS.md },
  areaTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  areaIconRing: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  areaEmoji: { fontSize: 22, fontWeight: '700' },
  areaName: { color: LUCY_COLORS.textDark, fontSize: 15.5, fontWeight: '800', lineHeight: 20 },
  areaCount: { color: LUCY_COLORS.textSubtle, fontSize: 13, fontWeight: '800' },
  // Top bar / breadcrumb
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingTop: 6 },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 10, marginLeft: -4 },
  backLabel: { color: LUCY_COLORS.textMuted, fontSize: 14, fontWeight: '700' },
  storyBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, paddingHorizontal: 12, backgroundColor: LUCY_COLORS.primarySoft, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: LUCY_COLORS.primaryLine },
  storyBtnText: { color: LUCY_COLORS.primary, fontSize: 12, fontWeight: '800' },
  sectionLabel: { color: LUCY_COLORS.textSubtle, fontSize: 10.5, fontWeight: '900', letterSpacing: 1.2, marginBottom: 10, marginTop: 6 },
  // Sub-topic rows
  topicRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 13, backgroundColor: LUCY_COLORS.surface, marginBottom: 10, borderRadius: RADIUS.control, borderWidth: 1, borderColor: LUCY_COLORS.border, ...LUCY_SHADOWS.sm },
  topicIconRing: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: LUCY_COLORS.primarySoft, borderWidth: 1, borderColor: LUCY_COLORS.primaryLine },
  topicEmoji: { fontSize: 18, color: LUCY_COLORS.primary },
  topicName: { color: LUCY_COLORS.textDark, fontSize: 15, fontWeight: '800' },
  topicCount: { color: LUCY_COLORS.textSubtle, fontSize: 12, marginTop: 2, fontWeight: '600' },
  // Items
  itemsHint: { color: LUCY_COLORS.textSubtle, fontSize: 11.5, marginTop: -4, marginBottom: 10, fontWeight: '600' },
  itemRow: { marginBottom: 10, backgroundColor: LUCY_COLORS.surface, borderRadius: RADIUS.control, padding: 14, gap: 7, borderWidth: 1, borderColor: LUCY_COLORS.border, ...LUCY_SHADOWS.sm },
  itemLabel: { color: LUCY_COLORS.textDark, fontSize: 14.5, fontWeight: '700', lineHeight: 20 },
  itemSub: { color: LUCY_COLORS.textMuted, fontSize: 12.5, lineHeight: 17 },
  loadingRow: { paddingVertical: 18, alignItems: 'center' },
  loadingText: { color: LUCY_COLORS.textSubtle, fontSize: 13, fontWeight: '600' },
  // Add controls
  addAreaBtn: { marginTop: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14, borderRadius: RADIUS.control, borderWidth: 1, borderStyle: 'dashed', borderColor: LUCY_COLORS.primaryLine, backgroundColor: LUCY_COLORS.primaryMist },
  addAreaText: { color: LUCY_COLORS.primary, fontSize: 14, fontWeight: '800' },
  addRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 8 },
  addBarRow: { borderTopWidth: 1, borderTopColor: LUCY_COLORS.borderSoft, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: LUCY_COLORS.surface },
  addInput: { flex: 1, backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: RADIUS.control, paddingHorizontal: 14, paddingVertical: 12, color: LUCY_COLORS.textDark, fontSize: 15, borderWidth: 1, borderColor: LUCY_COLORS.border },
  addBtn: { width: 46, height: 46, borderRadius: RADIUS.control, backgroundColor: LUCY_COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  addCancel: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  // Seeding modal — light bottom sheet
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(20,22,40,0.40)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: LUCY_COLORS.surfaceSheet, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 22, paddingTop: 12, paddingBottom: 30, gap: 8, ...LUCY_SHADOWS.lg },
  grip: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: LUCY_COLORS.border, marginBottom: 12 },
  seedEyebrow: { color: LUCY_COLORS.primary, fontSize: 10.5, fontWeight: '900', letterSpacing: 1.1, textTransform: 'uppercase' },
  seedTitle: { color: LUCY_COLORS.textDark, fontSize: 22, fontWeight: '900', letterSpacing: -0.3, marginTop: 2 },
  seedSub: { color: LUCY_COLORS.textMuted, fontSize: 14, lineHeight: 21, marginBottom: 6 },
  seedArea: { marginBottom: 14, gap: 8 },
  seedAreaHead: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  seedAreaDot: { width: 9, height: 9, borderRadius: 5 },
  seedAreaName: { color: LUCY_COLORS.textDark, fontSize: 15.5, fontWeight: '800' },
  seedChipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, paddingLeft: 18 },
  seedTopicChip: { backgroundColor: LUCY_COLORS.surfaceRaised, borderWidth: 1, borderColor: LUCY_COLORS.border, borderRadius: RADIUS.chip, paddingHorizontal: 10, paddingVertical: 5 },
  seedTopicChipText: { color: LUCY_COLORS.textMuted, fontSize: 12.5, fontWeight: '600' },
  seedAcceptBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: LUCY_COLORS.primary, borderRadius: RADIUS.control, paddingVertical: 15, marginTop: 8 },
  seedAcceptText: { color: LUCY_COLORS.white, fontSize: 15, fontWeight: '800' },
  seedDismiss: { color: LUCY_COLORS.textSubtle, fontSize: 13.5, fontWeight: '700' },
});
