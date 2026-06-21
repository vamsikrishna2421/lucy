/**
 * FreeUpSpace — the "Free up space" cleanup sheet (Phase 2 of the importance feature). LUCY pulls up
 * the user's least-important captures (low importance first, then oldest) so they can periodically
 * multi-select and delete the notes they no longer need to reclaim space.
 *
 * Design (docs/LUCY_DESIGN_SYSTEM.md): a full-height premium sheet matching DayShaper —
 *   grip → eyebrow + bold title + close → calm subline + live count → selectable rows → a footer
 *   delete bar that springs in only when something is selected. Each row reads top→bottom with clear
 *   hierarchy: an animated tick (Things-style), the title, a one-line snippet, a meta line with the
 *   relative date + an importance chip (color = meaning) + a 🖼 marker for image notes.
 *
 * Confirms route through the shared <ActionSheet> ("Delete N notes? This can't be undone."); success
 * is a calm <Toast> ("Freed N notes."). Deletes go ONLY through hardDeleteCapture — if one fails it's
 * skipped quietly (never a scary error state). Empty state is the warm <LucyEmptyState> orb.
 *
 * ADDITIVE + presentation-only: it reads via getLowImportanceCaptures and deletes via hardDeleteCapture
 * (both pre-built); it changes no data model or extraction logic. RN primitives + Animated (native
 * driver) only — no new deps, OTA-safe.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { LUCY_COLORS } from '../config/colors';
import { haptic } from '../config/haptics';
import { getDatabase } from '../db';
import { getLowImportanceCaptures, hardDeleteCapture, type CleanupCapture } from '../db/captures';
import { ActionSheet, Toast } from './ActionSheet';
import { LucyEmptyState } from './LucyEmptyState';

// ─── Importance chip metadata (color = meaning, from LUCY_COLORS) ───────────
type Importance = CleanupCapture['importance'];
const IMPORTANCE_META: Record<Importance, { label: string; fg: string; bg: string; border: string }> = {
  // Low — muted/grey, the safe-to-clear default the screen leads with.
  low: { label: 'Low', fg: LUCY_COLORS.textSubtle, bg: LUCY_COLORS.surface, border: LUCY_COLORS.border },
  // Normal — neutral warm tan, kept but available to clear.
  normal: { label: 'Normal', fg: LUCY_COLORS.textMuted, bg: LUCY_COLORS.surfaceRaised, border: LUCY_COLORS.border },
  // High never appears here (excluded by the query) — defined for completeness/typing.
  high: { label: 'Important', fg: LUCY_COLORS.primaryGlow, bg: LUCY_COLORS.primarySoft, border: LUCY_COLORS.primaryLine },
};

/** Relative date, matching the app's SQLite-timestamp handling (StalenessReviewCard.relativeTime). */
function relativeDate(isoOrSqlite: string): string {
  const when = new Date(isoOrSqlite.includes('T') ? isoOrSqlite : `${isoOrSqlite.replace(' ', 'T')}Z`);
  const ms = Date.now() - when.getTime();
  const d = Math.floor(ms / 86_400_000);
  if (d >= 30) {
    // Older than a month reads as a calendar date — calmer than "63 days ago".
    return when.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  if (d >= 2) return `${d} days ago`;
  if (d === 1) return 'Yesterday';
  const h = Math.floor(ms / 3_600_000);
  if (h >= 1) return `${h}h ago`;
  const m = Math.floor(ms / 60_000);
  return m >= 1 ? `${m}m ago` : 'Just now';
}

export function FreeUpSpace({
  visible,
  onClose,
  onChanged,
}: {
  visible: boolean;
  onClose: () => void;
  /** Fired after any deletion so the opener can refresh its count pill. */
  onChanged?: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<CleanupCapture[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const slide = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const footer = useRef(new Animated.Value(0)).current;

  // ── Load the least-important captures on open ──
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    setLoading(true);
    setSelected(new Set());
    void (async () => {
      const db = await getDatabase();
      const rows = await getLowImportanceCaptures(db).catch(() => [] as CleanupCapture[]);
      if (!alive) return;
      setItems(rows);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [visible]);

  // ── Sheet entrance (spring up + fade backdrop), matching DayShaper ──
  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(slide, { toValue: 1, tension: 64, friction: 12, useNativeDriver: true }),
        Animated.timing(fade, { toValue: 1, duration: 200, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]).start();
    } else {
      slide.setValue(0);
      fade.setValue(0);
    }
  }, [visible, slide, fade]);

  // ── Footer delete bar springs in only when a selection exists ──
  const count = selected.size;
  useEffect(() => {
    Animated.spring(footer, {
      toValue: count > 0 ? 1 : 0,
      tension: 90,
      friction: 13,
      useNativeDriver: true,
    }).start();
  }, [count, footer]);

  const lowCount = useMemo(() => items.filter((i) => i.importance === 'low').length, [items]);

  const toggle = (id: number) => {
    if (Platform.OS !== 'web') void haptic.tab();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllLow = () => {
    if (Platform.OS !== 'web') void haptic.tab();
    const lowIds = items.filter((i) => i.importance === 'low').map((i) => i.id);
    setSelected((prev) => {
      // If every low note is already picked, treat the chip as a clear-all of low items.
      const allLowSelected = lowIds.length > 0 && lowIds.every((id) => prev.has(id));
      if (allLowSelected) {
        const next = new Set(prev);
        lowIds.forEach((id) => next.delete(id));
        return next;
      }
      return new Set([...prev, ...lowIds]);
    });
  };

  const allLowSelected = lowCount > 0 && items.filter((i) => i.importance === 'low').every((i) => selected.has(i.id));

  // ── Perform the deletes sequentially; skip failures quietly (no scary states) ──
  const performDelete = async () => {
    const ids = items.filter((i) => selected.has(i.id)).map((i) => i.id);
    if (ids.length === 0) return;
    setDeleting(true);
    if (Platform.OS !== 'web') void haptic.destructive();
    const db = await getDatabase();
    const removed = new Set<number>();
    for (const id of ids) {
      try {
        const ok = await hardDeleteCapture(db, id);
        if (ok) removed.add(id);
      } catch {
        // One bad row never blocks the rest — skip it silently and keep going.
      }
    }
    setItems((prev) => prev.filter((i) => !removed.has(i.id)));
    setSelected(new Set());
    setDeleting(false);
    const n = removed.size;
    setToast(n > 0 ? `Freed ${n} note${n === 1 ? '' : 's'}.` : 'Nothing to remove.');
    if (n > 0) onChanged?.();
  };

  const translateY = slide.interpolate({ inputRange: [0, 1], outputRange: [600, 0] });
  const footerY = footer.interpolate({ inputRange: [0, 1], outputRange: [120, 0] });

  return (
    <>
      <Modal visible={visible} transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
        <Animated.View style={[styles.backdrop, { opacity: fade }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>

        <View style={styles.anchor} pointerEvents="box-none">
          <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
            <View style={styles.grip} />

            {/* Header */}
            <View style={styles.headerRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.eyebrow}>STORAGE · CLEANUP</Text>
                <Text style={styles.title}>Free up space</Text>
              </View>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={8}>
                <Text style={styles.closeText}>Close</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.lede}>
              Your least important notes — select any you don&apos;t need and delete to reclaim space.
            </Text>

            {loading ? (
              <View style={styles.loadingWrap}>
                <Text style={styles.loadingText}>Finding notes you can let go…</Text>
              </View>
            ) : items.length === 0 ? (
              <View style={styles.emptyWrap}>
                <LucyEmptyState
                  title="Nothing to clear"
                  message="Your memory is already tidy — every note you've kept is worth holding on to."
                />
              </View>
            ) : (
              <>
                {/* Count + quick action */}
                <View style={styles.countRow}>
                  <View style={styles.countBlock}>
                    <Text style={styles.countValue}>{items.length}</Text>
                    <Text style={styles.countLabel}>
                      {items.length === 1 ? 'note can be cleared' : 'notes can be cleared'}
                    </Text>
                  </View>
                  {lowCount > 0 ? (
                    <TouchableOpacity
                      activeOpacity={0.85}
                      style={[styles.selectAllChip, allLowSelected && styles.selectAllChipOn]}
                      onPress={selectAllLow}
                    >
                      <Text style={[styles.selectAllText, allLowSelected && styles.selectAllTextOn]}>
                        {allLowSelected ? '✓ All low selected' : `Select all low · ${lowCount}`}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>

                <ScrollView
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={[styles.listContent, count > 0 && styles.listContentWithFooter]}
                  keyboardShouldPersistTaps="handled"
                >
                  {items.map((item) => (
                    <CleanupRow
                      key={item.id}
                      item={item}
                      selected={selected.has(item.id)}
                      onToggle={() => toggle(item.id)}
                    />
                  ))}
                  <Text style={styles.footnote}>
                    Deleting a note also removes anything LUCY pulled from it. Important notes are kept safe and never shown here.
                  </Text>
                </ScrollView>
              </>
            )}

            {/* Footer delete bar — springs in only with a selection */}
            {items.length > 0 ? (
              <Animated.View
                pointerEvents={count > 0 ? 'auto' : 'none'}
                style={[styles.footer, { opacity: footer, transform: [{ translateY: footerY }] }]}
              >
                <TouchableOpacity
                  activeOpacity={0.9}
                  disabled={count === 0 || deleting}
                  style={[styles.deleteBtn, (count === 0 || deleting) && styles.deleteBtnDim]}
                  onPress={() => setConfirming(true)}
                >
                  <Text style={styles.deleteBtnText}>
                    {deleting ? 'Freeing space…' : `Delete selected · ${count}`}
                  </Text>
                </TouchableOpacity>
              </Animated.View>
            ) : null}
          </Animated.View>
        </View>
      </Modal>

      {/* Designed confirm — never a raw Alert */}
      <ActionSheet
        visible={confirming}
        onClose={() => setConfirming(false)}
        context="Free up space"
        title={`Delete ${count} note${count === 1 ? '' : 's'}?`}
        message="This can't be undone. The notes — and anything LUCY pulled from them — are removed for good."
        accent={LUCY_COLORS.error}
        actions={[
          {
            label: `Delete ${count} note${count === 1 ? '' : 's'}`,
            style: 'destructive',
            onPress: () => {
              setConfirming(false);
              void performDelete();
            },
          },
        ]}
        cancelLabel="Keep them"
      />

      <Toast visible={!!toast} message={toast ?? ''} onHide={() => setToast(null)} />
    </>
  );
}

// ─── A single selectable cleanup row ────────────────────────────────────────
function CleanupRow({
  item,
  selected,
  onToggle,
}: {
  item: CleanupCapture;
  selected: boolean;
  onToggle: () => void;
}) {
  const tick = useRef(new Animated.Value(selected ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(tick, { toValue: selected ? 1 : 0, tension: 180, friction: 12, useNativeDriver: true }).start();
  }, [selected, tick]);

  const chip = IMPORTANCE_META[item.importance];
  const tickScale = tick.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] });

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onToggle}
      style={[styles.row, selected && styles.rowSelected]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${item.title}. ${chip.label} importance, ${relativeDate(item.created_at)}`}
    >
      {/* Checkbox */}
      <View style={[styles.checkbox, selected && styles.checkboxOn]}>
        <Animated.Text style={[styles.checkmark, { opacity: tick, transform: [{ scale: tickScale }] }]}>
          ✓
        </Animated.Text>
      </View>

      {/* Body */}
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {item.title || 'Untitled note'}
        </Text>
        {item.snippet ? (
          <Text style={styles.rowSnippet} numberOfLines={1}>
            {item.snippet}
          </Text>
        ) : null}
        <View style={styles.metaRow}>
          <Text style={styles.metaDate}>{relativeDate(item.created_at)}</Text>
          <View style={styles.metaDot} />
          <View style={[styles.importanceChip, { backgroundColor: chip.bg, borderColor: chip.border }]}>
            <Text style={[styles.importanceText, { color: chip.fg }]}>{chip.label}</Text>
          </View>
          {item.has_image ? (
            <>
              <View style={styles.metaDot} />
              <Text style={styles.imageMark}>🖼</Text>
            </>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(20,22,40,0.40)' },
  anchor: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: LUCY_COLORS.surfaceSheet,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderWidth: 1,
    borderColor: LUCY_COLORS.border,
    paddingHorizontal: 20,
    paddingTop: 10,
    maxHeight: '92%',
    shadowColor: '#1A1B2E',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.1,
    shadowRadius: 24,
    elevation: 14,
  },
  grip: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: LUCY_COLORS.border, marginBottom: 12 },

  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 4 },
  eyebrow: { color: LUCY_COLORS.primaryGlow, fontSize: 10.5, fontWeight: '900', letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 4 },
  title: { color: LUCY_COLORS.textDark, fontSize: 25, fontWeight: '900', letterSpacing: -0.4 },
  closeBtn: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 13, backgroundColor: LUCY_COLORS.surface, marginTop: 6 },
  closeText: { color: LUCY_COLORS.textMuted, fontSize: 12.5, fontWeight: '700' },

  lede: { color: LUCY_COLORS.textMuted, fontSize: 13.5, lineHeight: 20, marginTop: 6, marginBottom: 16 },

  loadingWrap: { paddingVertical: 60, alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: LUCY_COLORS.textSubtle, fontSize: 13 },
  emptyWrap: { paddingTop: 8, paddingBottom: 24 },

  // Count + quick action
  countRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 },
  countBlock: { flexDirection: 'row', alignItems: 'baseline', gap: 8, flexShrink: 1 },
  countValue: { color: LUCY_COLORS.textDark, fontSize: 26, fontWeight: '900', letterSpacing: -0.5 },
  countLabel: { color: LUCY_COLORS.textSubtle, fontSize: 12.5, fontWeight: '700', flexShrink: 1 },
  selectAllChip: { borderRadius: 999, backgroundColor: LUCY_COLORS.surface, borderWidth: 1, borderColor: LUCY_COLORS.border, paddingHorizontal: 13, paddingVertical: 8 },
  selectAllChipOn: { backgroundColor: LUCY_COLORS.primarySoft, borderColor: LUCY_COLORS.primary },
  selectAllText: { color: LUCY_COLORS.textMuted, fontSize: 12, fontWeight: '800' },
  selectAllTextOn: { color: LUCY_COLORS.primaryGlow },

  listContent: { paddingBottom: 28 },
  listContentWithFooter: { paddingBottom: 96 },
  footnote: { color: LUCY_COLORS.textFaint, fontSize: 11.5, lineHeight: 17, marginTop: 14, paddingHorizontal: 2 },

  // Row
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    backgroundColor: LUCY_COLORS.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: LUCY_COLORS.border,
    paddingVertical: 13,
    paddingHorizontal: 14,
    marginBottom: 9,
  },
  rowSelected: { backgroundColor: LUCY_COLORS.surfaceRaised, borderColor: LUCY_COLORS.primaryLine },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 8,
    borderWidth: 1.6,
    borderColor: LUCY_COLORS.textFaint,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: LUCY_COLORS.primary, borderColor: LUCY_COLORS.primary },
  checkmark: { color: LUCY_COLORS.white, fontSize: 14, fontWeight: '900', marginTop: -1 },
  rowBody: { flex: 1 },
  rowTitle: { color: LUCY_COLORS.textDark, fontSize: 15, fontWeight: '800', letterSpacing: -0.2 },
  rowSnippet: { color: LUCY_COLORS.textMuted, fontSize: 12.5, lineHeight: 17, marginTop: 3 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 7 },
  metaDate: { color: LUCY_COLORS.textSubtle, fontSize: 11.5, fontWeight: '700' },
  metaDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: LUCY_COLORS.textFaint },
  importanceChip: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 3 },
  importanceText: { fontSize: 10.5, fontWeight: '800', letterSpacing: 0.3 },
  imageMark: { fontSize: 12 },

  // Footer
  footer: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 24,
  },
  deleteBtn: {
    backgroundColor: LUCY_COLORS.error,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: LUCY_COLORS.error,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 14,
    elevation: 8,
  },
  deleteBtnDim: { opacity: 0.5 },
  deleteBtnText: { color: LUCY_COLORS.white, fontSize: 16, fontWeight: '900', letterSpacing: -0.2 },
});
