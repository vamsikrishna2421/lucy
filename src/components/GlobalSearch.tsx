/**
 * GlobalSearch — LUCY's omnipresent, cross-feature search (Phase 2 of the v3 redesign, Pillar P2).
 *
 * A single search affordance lives in the app header on EVERY screen; tapping it opens this full-height
 * sheet that searches the user's own content. It is deliberately distinct from the in-list filter chips
 * (which stay scoped inside Timeline): this is RECALL across the whole brain, never demoted behind a tab.
 *
 * Wiring (for now): results come from the existing retrieval engine (`findSimilarCaptures` in
 * processing/vectorSearch) — the same multi-signal scorer extraction uses — so we don't reinvent search.
 *
 * Extensibility: results are normalised into a typed `SearchResult` union with a `source` discriminator
 * ('capture' today; 'task' | 'doc' | 'person' | 'meeting' | 'money' later). A new source just needs its
 * own fetcher that maps into a `SearchResult`, merged into `runSearch()` — the list/row UI already renders
 * any `SearchResult` by its `source` (domain accent + icon + media kind), so adding sources is additive.
 *
 * P4: FlatList virtualization (OTA-safe; no native FlashList dep), ≥48dp rows, reduce-motion-aware sheet
 * entrance, safe-area aware top/bottom, debounced queries, real empty/loading/idle states.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Keyboard,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LUCY_COLORS, LUCY_ELEVATION } from '../config/colors';
import { DURATION, motionConfig, SPRING, useReducedMotion } from '../config/motion';
import { typeStyle } from '../config/type';
import { haptic } from '../config/haptics';
import { DOMAIN_ACCENT, MediaCard, type DomainKey } from './ui';
import { getDatabase } from '../db';
import { findSimilarCaptures } from '../processing/vectorSearch';
import { parseDbDate } from '../utils/datetime';

// ── The typed, extensible result model ───────────────────────────────────────────────────────────
// Every source normalises into this. To add a new source, produce SearchResult[] from its own fetcher
// and merge it in runSearch(); the row renderer already handles any source via `domain` + `kind`.
export type SearchSource = 'capture' | 'task' | 'doc' | 'person' | 'meeting' | 'money';

export interface SearchResult {
  id: string;            // stable, source-prefixed (e.g. "capture:42")
  source: SearchSource;  // discriminator → drives label + accent + icon
  title: string;         // primary line
  context?: string;      // one-line supporting context
  time?: string;         // right-aligned timestamp
  domain: DomainKey;     // media accent (maps from source)
  kind: 'text' | 'photo' | 'voice' | 'doc' | 'place' | 'person'; // MediaCard kind
  imageUri?: string;
  score: number;         // for cross-source ranking
  onOpen?: () => void;   // canonical open action (optional; wired by host later)
}

const SOURCE_META: Record<SearchSource, { label: string; domain: DomainKey }> = {
  capture: { label: 'Note', domain: 'note' },
  task:    { label: 'Task', domain: 'task' },
  doc:     { label: 'Document', domain: 'doc' },
  person:  { label: 'Person', domain: 'person' },
  meeting: { label: 'Meeting', domain: 'meeting' },
  money:   { label: 'Money', domain: 'money' },
};

function relativeTime(iso: string): string {
  try {
    const d = parseDbDate(iso);
    const diff = Date.now() - d.getTime();
    const mins = Math.round(diff / 60000);
    if (mins < 1) return 'now';
    if (mins < 60) return `${mins}m`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    const days = Math.round(hrs / 24);
    if (days < 7) return `${days}d`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

/**
 * runSearch — the single fan-out point. Today: captures only. To extend, add more `await fetchX(...)`
 * calls that each return SearchResult[], concat them, and re-sort by score.
 */
async function runSearch(query: string): Promise<SearchResult[]> {
  const db = await getDatabase();
  const results: SearchResult[] = [];

  // ── Source: captures (existing multi-signal retrieval) ──
  try {
    const similar = await findSimilarCaptures(db, query, 30, 0.1);
    for (const s of similar) {
      const c = s.capture;
      const title = (c.extracted_title || c.raw_transcript || 'Untitled').trim();
      const body = (c.raw_transcript || c.structured_text || '').trim();
      const context = body && body !== title ? body : undefined;
      results.push({
        id: `capture:${c.id}`,
        source: 'capture',
        title: title.slice(0, 120),
        context: context?.slice(0, 140),
        time: relativeTime(c.created_at),
        domain: SOURCE_META.capture.domain,
        kind: c.source_image_path ? 'photo' : c.source === 'voice' ? 'voice' : 'text',
        imageUri: c.source_image_path ?? undefined,
        score: s.score,
      });
    }
  } catch {
    // No scary states — an empty result reads as "nothing found", not an error.
  }

  // ── Future sources go here (tasks / docs / people / meetings / money) → results.push(...) ──

  return results.sort((a, b) => b.score - a.score);
}

export function GlobalSearch({
  visible,
  onClose,
  onOpenResult,
}: {
  visible: boolean;
  onClose: () => void;
  /** Host wires this to navigate to the canonical item (Timeline/detail). Optional. */
  onOpenResult?: (result: SearchResult) => void;
}) {
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const reqId = useRef(0);

  const slide = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      slide.setValue(0);
      if (reduced) slide.setValue(1);
      else Animated.spring(slide, { toValue: 1, ...SPRING.settle }).start();
      const t = setTimeout(() => inputRef.current?.focus(), 220);
      return () => clearTimeout(t);
    }
    // Reset state when hidden so the next open is clean.
    setQuery('');
    setResults(null);
    setLoading(false);
    return undefined;
  }, [visible, reduced, slide]);

  // Debounced search.
  useEffect(() => {
    if (!visible) return;
    const q = query.trim();
    if (q.length < 2) { setResults(null); setLoading(false); return; }
    setLoading(true);
    const myReq = ++reqId.current;
    const handle = setTimeout(() => {
      void (async () => {
        const r = await runSearch(q);
        if (myReq === reqId.current) { setResults(r); setLoading(false); }
      })();
    }, 280);
    return () => clearTimeout(handle);
  }, [query, visible]);

  const close = useCallback(() => {
    Keyboard.dismiss();
    if (reduced) { onClose(); return; }
    Animated.timing(slide, motionConfig({ toValue: 0, duration: DURATION.fast }, reduced)).start(onClose);
  }, [onClose, reduced, slide]);

  const openResult = useCallback((r: SearchResult) => {
    haptic.tab();
    close();
    setTimeout(() => { r.onOpen?.(); onOpenResult?.(r); }, reduced ? 0 : 180);
  }, [close, onOpenResult, reduced]);

  const renderItem = useCallback(({ item }: { item: SearchResult }) => (
    <View style={styles.rowWrap}>
      <View style={styles.sourceTag}>
        <Text style={[typeStyle('ui.eyebrow'), { color: DOMAIN_ACCENT[item.domain] }]}>
          {SOURCE_META[item.source].label}
        </Text>
      </View>
      <MediaCard
        kind={item.kind}
        title={item.title}
        context={item.context}
        time={item.time}
        imageUri={item.imageUri}
        domain={item.domain}
        onPress={() => openResult(item)}
      />
    </View>
  ), [openResult]);

  const headerTranslate = slide.interpolate({ inputRange: [0, 1], outputRange: [24, 0] });
  const idle = query.trim().length < 2;

  const body = useMemo(() => {
    if (loading) {
      return (
        <View style={styles.centerState}>
          <ActivityIndicator color={LUCY_COLORS.primary} />
          <Text style={[typeStyle('ui.meta'), styles.stateText]}>Searching your brain…</Text>
        </View>
      );
    }
    if (idle) {
      return (
        <View style={styles.centerState}>
          <Ionicons name="search" size={40} color={LUCY_COLORS.textFaint} />
          <Text style={[typeStyle('ui.subtitle'), styles.stateTitle]}>Search everything</Text>
          <Text style={[typeStyle('ui.meta'), styles.stateText]}>
            Find any note, idea, or moment you've captured. Type a word, a name, or a feeling.
          </Text>
        </View>
      );
    }
    if (results && results.length === 0) {
      return (
        <View style={styles.centerState}>
          <Ionicons name="sparkles-outline" size={40} color={LUCY_COLORS.textFaint} />
          <Text style={[typeStyle('ui.subtitle'), styles.stateTitle]}>Nothing matched yet</Text>
          <Text style={[typeStyle('ui.meta'), styles.stateText]}>
            Try a different word — Lucy searches meaning, not just exact text.
          </Text>
        </View>
      );
    }
    return (
      <FlatList
        data={results ?? []}
        keyExtractor={(it) => it.id}
        renderItem={renderItem}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingBottom: insets.bottom + 24, paddingTop: 4 }}
        showsVerticalScrollIndicator={false}
        // Virtualization tuning (OTA-safe FlatList; covers the "could be long" P4 requirement).
        initialNumToRender={12}
        windowSize={11}
        removeClippedSubviews
      />
    );
  }, [loading, idle, results, renderItem, insets.bottom]);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={close}>
      <View style={styles.backdrop}>
        <Animated.View
          style={[
            styles.sheet,
            { paddingTop: insets.top + 6, opacity: slide },
          ]}
        >
          {/* Search bar */}
          <Animated.View style={[styles.searchRow, { transform: [{ translateY: headerTranslate }] }]}>
            <View style={styles.searchField}>
              <Ionicons name="search" size={20} color={LUCY_COLORS.textMuted} />
              <TextInput
                ref={inputRef}
                value={query}
                onChangeText={setQuery}
                placeholder="Search your brain…"
                placeholderTextColor={LUCY_COLORS.textFaint}
                style={[typeStyle('ui.body'), styles.searchInput]}
                returnKeyType="search"
                autoCorrect={false}
                accessibilityLabel="Search everything"
              />
              {query.length > 0 ? (
                <Pressable hitSlop={10} onPress={() => setQuery('')} accessibilityLabel="Clear search">
                  <Ionicons name="close-circle" size={20} color={LUCY_COLORS.textFaint} />
                </Pressable>
              ) : null}
            </View>
            <Pressable
              onPress={close}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Close search"
              style={({ pressed }) => [styles.cancelBtn, pressed && { opacity: 0.6 }]}
            >
              <Text style={[typeStyle('ui.bodyStrong'), { color: LUCY_COLORS.primary }]}>Done</Text>
            </Pressable>
          </Animated.View>

          {body}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: LUCY_ELEVATION.scrim },
  sheet: { flex: 1, backgroundColor: LUCY_COLORS.background, paddingHorizontal: 16 },

  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  searchField: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: 24,
    backgroundColor: LUCY_COLORS.surfaceRaised,
    borderWidth: 1,
    borderColor: LUCY_COLORS.border,
  },
  searchInput: { flex: 1, color: LUCY_COLORS.textDark, paddingVertical: 0 },
  cancelBtn: { minHeight: 48, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },

  rowWrap: { marginBottom: 10 },
  sourceTag: { marginBottom: 4, marginLeft: 4 },

  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 10, paddingBottom: 60 },
  stateTitle: { marginTop: 6 },
  stateText: { textAlign: 'center', lineHeight: 20 },
});
