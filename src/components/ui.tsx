/**
 * LUCY UI kit — the shared, premium primitive library for the LIGHT + INDIGO system.
 * Ported from the `scuts` reference (white radius-22 cards, soft neutral shadow, solid indigo buttons,
 * tinted pills, crisp near-black hierarchy) but built entirely on LUCY's tokens so it re-skins with the
 * palette. RN primitives only — no native deps, OTA-safe.
 *
 * Reach for these BEFORE writing bespoke styles so every screen shares one anatomy (see
 * docs/LUCY_DESIGN_SYSTEM.md → "The component kit"). All components are additive + presentation-only.
 *
 *   <Card><SectionHeader title="Today" subtitle="3 things" /> … </Card>
 *   <PrimaryButton title="Save" icon="checkmark" onPress={save} />
 *   <SecondaryButton title="Skip" tint={LUCY_COLORS.violet} onPress={skip} />
 *   <Pill label="Idea" color={LUCY_COLORS.violet} icon="bulb" />
 *   <Row gap={12}><StatTile value="7" label="Captures" /><StatTile value="2" label="Due" /></Row>
 *   <TextField placeholder="Add a note" value={v} onChangeText={setV} />
 *   <EmptyState icon="sparkles" title="Nothing yet" text="Capture a thought to begin." />
 */
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { LUCY_COLORS, LUCY_SHADOWS } from '../config/colors';

// MARK: scale tokens (mirror scuts R / S so spacing reads the same across the kit)
export const RADIUS = { card: 22, control: 14, chip: 12, pill: 999 } as const;
export const SPACE = { screen: 18, gap: 14, tight: 8 } as const;

type IconName = keyof typeof Ionicons.glyphMap;

export function Icon({
  name,
  size = 18,
  color = LUCY_COLORS.textDark,
}: {
  name: IconName | string;
  size?: number;
  color?: string;
}) {
  return <Ionicons name={name as IconName} size={size} color={color} />;
}

/** The default container: a white card with a soft neutral shadow + hairline border. */
export function Card({
  children,
  style,
  /** Drop the elevation (e.g. when nested on a surfaceRaised tile). */
  flat,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  flat?: boolean;
}) {
  return <View style={[styles.card, flat && styles.cardFlat, style]}>{children}</View>;
}

/** A simple horizontal row helper (e.g. a row of StatTiles). */
export function Row({
  children,
  gap = SPACE.gap,
  style,
}: {
  children: React.ReactNode;
  gap?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[{ flexDirection: 'row', gap }, style]}>{children}</View>;
}

/** One filled indigo CTA per surface — white label. */
export function PrimaryButton({
  title,
  onPress,
  icon,
  disabled,
  style,
}: {
  title: string;
  onPress: () => void;
  icon?: IconName | string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.primaryBtn,
        disabled && { opacity: 0.45 },
        pressed && !disabled && styles.primaryBtnPressed,
        style,
      ]}
    >
      {icon ? <Ionicons name={icon as IconName} size={18} color={LUCY_COLORS.white} style={{ marginRight: 8 }} /> : null}
      <Text style={styles.primaryText}>{title}</Text>
    </Pressable>
  );
}

/** Outline/tinted button — `tint + '1F'` background, tint label. Pairs with one PrimaryButton. */
export function SecondaryButton({
  title,
  onPress,
  icon,
  disabled,
  tint = LUCY_COLORS.primary,
  style,
}: {
  title: string;
  onPress: () => void;
  icon?: IconName | string;
  disabled?: boolean;
  tint?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.secondaryBtn,
        { backgroundColor: tint + '1F' },
        disabled && { opacity: 0.45 },
        pressed && { opacity: 0.7 },
        style,
      ]}
    >
      {icon ? <Ionicons name={icon as IconName} size={17} color={tint} style={{ marginRight: 6 }} /> : null}
      <Text style={[styles.secondaryText, { color: tint }]}>{title}</Text>
    </Pressable>
  );
}

/** A destructive outline action — error text on a transparent, error-tinted outline. */
export function DangerButton({
  title,
  onPress,
  icon,
  style,
}: {
  title: string;
  onPress: () => void;
  icon?: IconName | string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.dangerBtn, pressed && { opacity: 0.7 }, style]}
    >
      {icon ? <Ionicons name={icon as IconName} size={17} color={LUCY_COLORS.error} style={{ marginRight: 6 }} /> : null}
      <Text style={styles.dangerText}>{title}</Text>
    </Pressable>
  );
}

/** Section title (19/800) + dim subtitle, with an optional right slot. */
export function SectionHeader({
  title,
  subtitle,
  right,
  style,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.sectionRow, style]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {subtitle ? <Text style={styles.sectionSub}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

/** A short UPPERCASE eyebrow/kicker that sets context above a title. */
export function Eyebrow({ children, color = LUCY_COLORS.primary }: { children: React.ReactNode; color?: string }) {
  return <Text style={[styles.eyebrow, { color }]}>{children}</Text>;
}

/** Category/status pill — `color + '24'` background, color text. */
export function Pill({ label, color, icon }: { label: string; color: string; icon?: IconName | string }) {
  return (
    <View style={[styles.pill, { backgroundColor: color + '24' }]}>
      {icon ? <Ionicons name={icon as IconName} size={11} color={color} style={{ marginRight: 4 }} /> : null}
      <Text style={[styles.pillText, { color }]}>{label}</Text>
    </View>
  );
}

export function PriorityDot({ color }: { color: string }) {
  return <View style={[styles.dot, { backgroundColor: color }]} />;
}

/** A circular monogram avatar (defaults to the indigo brand fill). */
export function Avatar({ label, size = 46, color = LUCY_COLORS.primary }: { label: string; size?: number; color?: string }) {
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: color }]}>
      <Text style={{ color: LUCY_COLORS.white, fontWeight: '800', fontSize: size * 0.38 }}>{label}</Text>
    </View>
  );
}

/** A small round icon "ring" — tinted background + line, the standard header glyph for a card. */
export function IconRing({
  icon,
  size = 52,
  color = LUCY_COLORS.primary,
}: {
  icon: IconName | string;
  size?: number;
  color?: string;
}) {
  return (
    <View
      style={[
        styles.iconRing,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: color + '1A', borderColor: color + '33' },
      ]}
    >
      <Ionicons name={icon as IconName} size={size * 0.42} color={color} />
    </View>
  );
}

/** A white card with a big number + small label — the stat unit (use inside a <Row>). */
export function StatTile({
  value,
  label,
  icon,
  tint = LUCY_COLORS.primary,
}: {
  value: string;
  label: string;
  icon?: IconName | string;
  tint?: string;
}) {
  return (
    <View style={styles.statTile}>
      {icon ? <Ionicons name={icon as IconName} size={18} color={tint} style={{ marginBottom: 6 }} /> : null}
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel} numberOfLines={1}>{label}</Text>
    </View>
  );
}

/** An elevated-surface text input with a hairline border. */
export function TextField(props: TextInputProps & { containerStyle?: StyleProp<ViewStyle> }) {
  const { containerStyle, style, ...rest } = props;
  return (
    <View style={[styles.field, containerStyle]}>
      <TextInput placeholderTextColor={LUCY_COLORS.textFaint} style={[styles.fieldInput, style]} {...rest} />
    </View>
  );
}

/** A faint-icon empty state — title + optional supporting line, roomy. */
export function EmptyState({
  icon,
  title,
  text,
  style,
}: {
  icon: IconName | string;
  title: string;
  text?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.empty, style]}>
      <Ionicons name={icon as IconName} size={42} color={LUCY_COLORS.textFaint} />
      <Text style={styles.emptyTitle}>{title}</Text>
      {text ? <Text style={styles.emptyText}>{text}</Text> : null}
    </View>
  );
}

/** A hairline divider. */
export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.divider, style]} />;
}

const styles = StyleSheet.create({
  card: { backgroundColor: LUCY_COLORS.surface, borderRadius: RADIUS.card, padding: 18, ...LUCY_SHADOWS.md },
  cardFlat: { backgroundColor: LUCY_COLORS.surfaceRaised, borderWidth: 1, borderColor: LUCY_COLORS.border, shadowOpacity: 0, elevation: 0 },

  primaryBtn: {
    backgroundColor: LUCY_COLORS.primary,
    borderRadius: RADIUS.control,
    paddingVertical: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnPressed: { backgroundColor: LUCY_COLORS.primaryDeep },
  primaryText: { color: LUCY_COLORS.white, fontWeight: '700', fontSize: 16 },

  secondaryBtn: { borderRadius: RADIUS.control, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontWeight: '700', fontSize: 16 },

  dangerBtn: {
    borderRadius: RADIUS.control,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: LUCY_COLORS.error + '5C',
  },
  dangerText: { fontWeight: '700', fontSize: 16, color: LUCY_COLORS.error },

  sectionRow: { flexDirection: 'row', alignItems: 'center' },
  sectionTitle: { fontSize: 19, fontWeight: '800', color: LUCY_COLORS.textDark },
  sectionSub: { fontSize: 13.5, color: LUCY_COLORS.textMuted, marginTop: 1 },
  eyebrow: { fontSize: 11, fontWeight: '900', letterSpacing: 1, textTransform: 'uppercase' },

  pill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 9, paddingVertical: 4, borderRadius: RADIUS.pill, alignSelf: 'flex-start' },
  pillText: { fontSize: 11.5, fontWeight: '700' },
  dot: { width: 8, height: 8, borderRadius: 4 },

  avatar: { alignItems: 'center', justifyContent: 'center' },
  iconRing: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },

  statTile: { flex: 1, backgroundColor: LUCY_COLORS.surface, borderRadius: RADIUS.card, padding: 14, ...LUCY_SHADOWS.md },
  statValue: { fontSize: 22, fontWeight: '800', color: LUCY_COLORS.textDark },
  statLabel: { fontSize: 12, color: LUCY_COLORS.textMuted, marginTop: 2 },

  field: { backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: RADIUS.control, borderWidth: 1, borderColor: LUCY_COLORS.border },
  fieldInput: { paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: LUCY_COLORS.textDark },

  empty: { alignItems: 'center', paddingVertical: 40, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: LUCY_COLORS.textDark, marginTop: 6 },
  emptyText: { fontSize: 14, color: LUCY_COLORS.textMuted, textAlign: 'center', paddingHorizontal: 30, lineHeight: 20 },

  divider: { height: 1, backgroundColor: LUCY_COLORS.divider },
});
