/**
 * CollapsibleSection — a titled section that's collapsed by default with a count badge, expanding on tap.
 * Part of the UI-density pass (calmer screens, one focal thing at a time, progressive disclosure). Pure
 * RN Animated (native-driver fade) so it ships over-the-air; no native gesture/animation libs.
 *
 * Design system: eyebrow-weight title + count chip + chevron; body steps onto the surface below.
 */
import { useRef, useState } from 'react';
import { Animated, Easing, LayoutAnimation, Platform, StyleSheet, Text, TouchableOpacity, UIManager, View } from 'react-native';
import { LUCY_COLORS } from '../config/colors';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export function CollapsibleSection({
  title,
  count,
  defaultExpanded = false,
  children,
  accent = LUCY_COLORS.primaryGlow,
}: {
  title: string;
  /** Shown as a chip next to the title (e.g. how many items hide inside). Omit to hide the chip. */
  count?: number;
  defaultExpanded?: boolean;
  children: React.ReactNode;
  accent?: string;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const chevron = useRef(new Animated.Value(defaultExpanded ? 1 : 0)).current;

  const toggle = () => {
    const next = !expanded;
    LayoutAnimation.configureNext(LayoutAnimation.create(180, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity));
    Animated.timing(chevron, { toValue: next ? 1 : 0, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
    setExpanded(next);
  };

  const rotate = chevron.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '90deg'] });

  return (
    <View style={styles.wrap}>
      <TouchableOpacity style={styles.header} activeOpacity={0.7} onPress={toggle} accessibilityRole="button">
        <Text style={[styles.title, { color: accent }]}>{title}</Text>
        {typeof count === 'number' && count > 0 ? (
          <View style={styles.countChip}><Text style={styles.countText}>{count}</Text></View>
        ) : null}
        <View style={{ flex: 1 }} />
        <Animated.Text style={[styles.chevron, { transform: [{ rotate }] }]}>›</Animated.Text>
      </TouchableOpacity>
      {expanded ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 4 },
  title: { fontSize: 11, fontWeight: '900', letterSpacing: 1, textTransform: 'uppercase' },
  countChip: { minWidth: 20, paddingHorizontal: 7, paddingVertical: 1, borderRadius: 999, backgroundColor: LUCY_COLORS.surfaceRaised, borderWidth: 1, borderColor: LUCY_COLORS.border, alignItems: 'center' },
  countText: { color: LUCY_COLORS.textMuted, fontSize: 11, fontWeight: '800' },
  chevron: { color: LUCY_COLORS.textSubtle, fontSize: 22, fontWeight: '300', marginTop: -2 },
  body: { marginTop: 2 },
});
