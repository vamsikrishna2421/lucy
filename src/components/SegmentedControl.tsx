/**
 * SegmentedControl — a shared, premium segmented switcher with a single highlight pill that SLIDES
 * (spring) between options instead of hard-cutting. One motion signature reused across the app
 * (Dashboard view nav, Calendar agenda/day/week/month, etc.), matching the iOS / Notion-Calendar feel.
 *
 * Additive + presentation-only: callers pass their existing options + value + onChange. No new deps —
 * RN primitives + Animated (native driver where possible). The sliding pill uses left/width (layout
 * props), so that track runs on the JS driver; everything else is cheap.
 *
 * Design-system spring: tension ~68, friction ~12 (see docs/LUCY_DESIGN_SYSTEM.md → Motion).
 */
import { useEffect, useRef, useState } from 'react';
import { Animated, LayoutChangeEvent, StyleSheet, Text, TouchableOpacity, View, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LUCY_COLORS } from '../config/colors';

export type SegmentOption<T extends string> = {
  value: T;
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
};

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  style,
  compact,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  style?: ViewStyle | ViewStyle[];
  /** Tighter padding for dense rows (e.g. the calendar switcher). */
  compact?: boolean;
}) {
  const [trackWidth, setTrackWidth] = useState(0);
  const slide = useRef(new Animated.Value(0)).current; // index position, animated
  const activeIndex = Math.max(0, options.findIndex((o) => o.value === value));
  const count = options.length || 1;
  const pad = 3; // inner track padding
  const segWidth = trackWidth > 0 ? (trackWidth - pad * 2) / count : 0;

  useEffect(() => {
    // Spring the highlight toward the active segment. Native driver can't animate `left`, so we
    // keep this on the JS driver (cheap, single value) — motion still feels premium.
    Animated.spring(slide, {
      toValue: activeIndex,
      tension: 68,
      friction: 12,
      useNativeDriver: false,
    }).start();
  }, [activeIndex, slide]);

  const onTrackLayout = (e: LayoutChangeEvent) => setTrackWidth(e.nativeEvent.layout.width);

  const pillLeft = slide.interpolate({
    inputRange: options.map((_, i) => i),
    outputRange: options.map((_, i) => pad + i * segWidth),
    extrapolate: 'clamp',
  });

  return (
    <View style={[styles.track, compact && styles.trackCompact, style]} onLayout={onTrackLayout}>
      {segWidth > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.pill, compact && styles.pillCompact, { width: segWidth, left: pillLeft }]}
        />
      ) : null}
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <TouchableOpacity
            key={opt.value}
            activeOpacity={0.8}
            style={[styles.seg, compact && styles.segCompact]}
            onPress={() => { if (!active) onChange(opt.value); }}
          >
            {opt.icon ? (
              <Ionicons
                name={opt.icon}
                size={14}
                color={active ? LUCY_COLORS.primaryGlow : LUCY_COLORS.textMuted}
                style={{ marginBottom: 2 }}
              />
            ) : null}
            <Text style={[styles.segText, compact && styles.segTextCompact, active && styles.segTextActive]} numberOfLines={1}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: 16,
    backgroundColor: LUCY_COLORS.surfaceSheet,
    borderWidth: 1,
    borderColor: LUCY_COLORS.borderSoft,
    position: 'relative',
    overflow: 'hidden',
  },
  trackCompact: { borderRadius: 13 },
  pill: {
    position: 'absolute',
    top: 3,
    bottom: 3,
    borderRadius: 13,
    backgroundColor: LUCY_COLORS.surfaceRaised,
    borderWidth: 1,
    borderColor: LUCY_COLORS.border,
    shadowColor: LUCY_COLORS.primary,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 3,
  },
  pillCompact: { borderRadius: 10 },
  seg: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 7, borderRadius: 13, zIndex: 1 },
  segCompact: { paddingVertical: 6 },
  segText: { color: LUCY_COLORS.textMuted, fontWeight: '700', fontSize: 12 },
  segTextCompact: { fontSize: 12 },
  segTextActive: { color: LUCY_COLORS.primaryGlow, fontWeight: '800' },
});
