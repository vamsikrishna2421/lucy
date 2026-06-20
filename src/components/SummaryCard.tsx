/**
 * SummaryCard — a compact, tappable "N items · next: X → open" card that stands in for a long inline
 * list (progressive disclosure for the UI-density pass). Tap to open the full view/deck. Pure RN.
 *
 * Design system: surface-raised card, eyebrow + count, a muted lead line, a chevron affordance.
 */
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LUCY_COLORS } from '../config/colors';

export function SummaryCard({
  eyebrow,
  count,
  lead,
  onPress,
  accent = LUCY_COLORS.primary,
}: {
  eyebrow: string;          // e.g. "TO REVIEW"
  count?: number;           // e.g. 5 → shows a chip
  lead: string;             // one muted line: "next: send Priya the invoice"
  onPress: () => void;
  accent?: string;
}) {
  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.85} onPress={onPress} accessibilityRole="button">
      <View style={[styles.accent, { backgroundColor: accent }]} />
      <View style={styles.body}>
        <View style={styles.topRow}>
          <Text style={[styles.eyebrow, { color: accent }]} numberOfLines={1}>{eyebrow}</Text>
          {typeof count === 'number' && count > 0 ? (
            <View style={styles.countChip}><Text style={styles.countText}>{count}</Text></View>
          ) : null}
        </View>
        <Text style={styles.lead} numberOfLines={1}>{lead}</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 16, borderWidth: 1, borderColor: LUCY_COLORS.border, paddingVertical: 14, paddingHorizontal: 14, overflow: 'hidden' },
  accent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  body: { flex: 1, gap: 3 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  eyebrow: { fontSize: 10, fontWeight: '900', letterSpacing: 1, textTransform: 'uppercase', flexShrink: 1 },
  countChip: { minWidth: 20, paddingHorizontal: 7, paddingVertical: 1, borderRadius: 999, backgroundColor: LUCY_COLORS.surface, borderWidth: 1, borderColor: LUCY_COLORS.border, alignItems: 'center' },
  countText: { color: LUCY_COLORS.textMuted, fontSize: 11, fontWeight: '800' },
  lead: { color: LUCY_COLORS.textMuted, fontSize: 13.5, fontWeight: '600' },
  chevron: { color: LUCY_COLORS.textSubtle, fontSize: 24, fontWeight: '300' },
});
