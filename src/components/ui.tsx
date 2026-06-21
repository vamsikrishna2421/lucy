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
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Image,
  PanResponder,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import {
  amberGlow,
  amberWash,
  LUCY_COLORS,
  LUCY_SHADOWS,
  withAlpha,
} from '../config/colors';
import { DURATION, SPRING, motionConfig, useReducedMotion } from '../config/motion';
import { typeStyle } from '../config/type';
import { haptic } from '../config/haptics';
import { AnimatedFace, type LucyStatus } from './AnimatedFace';

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

// ════════════════════════════════════════════════════════════════════════════════════════════════
// P5 — Visual Craft primitives (v3 redesign). Additive + presentation-only; built on the craft tokens
// (type.ts / motion.ts / colors.ts depth layer) so they re-skin and respect reduce-motion automatically.
// ════════════════════════════════════════════════════════════════════════════════════════════════

type IconNameP5 = keyof typeof Ionicons.glyphMap | string;

// ── Domain accent map (content-type glyph-chips / teaser colors) ─────────────────────────────────
// Per-domain accents for the media fallback + teasers, drawn from existing tokens (no new hex).
export const DOMAIN_ACCENT = {
  idea:    LUCY_COLORS.violet,
  task:    LUCY_COLORS.primary,
  money:   LUCY_COLORS.success,
  health:  LUCY_COLORS.rose,
  meeting: LUCY_COLORS.info,
  doc:     LUCY_COLORS.cyan,
  place:   LUCY_COLORS.info,
  person:  LUCY_COLORS.primary,
  voice:   LUCY_COLORS.teal,
  photo:   LUCY_COLORS.gold,
  note:    LUCY_COLORS.textMuted,
} as const;
export type DomainKey = keyof typeof DOMAIN_ACCENT;

function phaseForHourLocal(hour: number): 'morning' | 'day' | 'evening' | 'night' {
  if (hour >= 22 || hour < 6) return 'night';
  if (hour < 11) return 'morning';
  if (hour >= 18) return 'evening';
  return 'day';
}

/**
 * LucyHero — the living-orb HERO. Renders the real AnimatedFace orb at a large scale with a soft
 * time-of-day amber wash behind it and ONE warm Lucy-voiced line (display type). One dominant element.
 *
 * The orb is a fixed 46dp internally; we scale it via transform (default ~2.2× ≈ 100dp). The amber
 * wash + halo are layered translucencies (no gradient dep). Reduce-motion: the orb keeps its own
 * (already reduce-aware-friendly) gentle life, but we skip the line's entrance fade.
 *
 * Props:
 *   state       — 'idle' | 'listening' | 'thinking' | 'speaking' | 'celebrate' (drives the orb).
 *   line        — the warm Lucy sentence under the orb (rendered in display voice). Optional.
 *   eyebrow     — small UPPERCASE kicker above the orb (e.g. "GOOD MORNING"). Optional.
 *   onPressOrb  — tap handler forwarded to the orb (defaults to a no-op).
 *   unreadCount — forwarded to the orb's badge (default 0).
 *   scale       — orb size multiplier (default 2.2).
 *   style       — container style.
 */
export function LucyHero({
  state = 'idle',
  line,
  eyebrow,
  onPressOrb,
  unreadCount = 0,
  scale = 2.2,
  style,
}: {
  state?: 'idle' | 'listening' | 'thinking' | 'speaking' | 'celebrate';
  line?: string;
  eyebrow?: string;
  onPressOrb?: () => void;
  unreadCount?: number;
  scale?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReducedMotion();
  const phase = phaseForHourLocal(new Date().getHours());
  const wash = amberWash(phase);
  const glow = amberGlow(1);

  // 'celebrate' isn't a LucyStatus — it's a one-shot via the orb's celebrateKey. Map the rest 1:1.
  const orbStatus: LucyStatus = state === 'celebrate' ? 'idle' : (state as LucyStatus);
  const [celebrateKey, setCelebrateKey] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (state === 'celebrate') setCelebrateKey(Date.now());
  }, [state]);

  // Gentle entrance for the line (skipped on reduce-motion).
  const lineIn = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) { lineIn.setValue(1); return; }
    lineIn.setValue(0);
    const a = Animated.timing(lineIn, motionConfig({ toValue: 1, duration: DURATION.slow, delay: 120 }, reduced));
    a.start();
    return () => a.stop();
  }, [reduced, line, lineIn]);

  const orbBox = 46 * scale; // the orb's intrinsic 46dp wrap, scaled.

  return (
    <View
      style={[styles.heroWrap, style]}
      accessible
      accessibilityRole="header"
      accessibilityLabel={[eyebrow, line].filter(Boolean).join('. ') || 'Lucy'}
    >
      {/* Time-of-day ambient wash — three stacked soft bands behind the orb. */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <View style={[styles.heroWashTop, { backgroundColor: wash.top }]} />
        <View style={[styles.heroWashMid, { backgroundColor: wash.mid }]} />
      </View>

      {eyebrow ? <Text style={[typeStyle('ui.eyebrow'), { color: LUCY_COLORS.primary }]}>{eyebrow}</Text> : null}

      <View style={[styles.heroOrbBox, { width: orbBox, height: orbBox }]}>
        {/* Amber halo — concentric translucent circles (radial feel without a gradient dep). */}
        <View pointerEvents="none" style={[styles.heroHalo, { width: orbBox * 1.25, height: orbBox * 1.25, borderRadius: orbBox, backgroundColor: glow.outer }]} />
        <View pointerEvents="none" style={[styles.heroHalo, { width: orbBox * 0.95, height: orbBox * 0.95, borderRadius: orbBox, backgroundColor: glow.mid }]} />
        <View style={{ transform: [{ scale }] }}>
          <AnimatedFace
            unreadCount={unreadCount}
            onPress={onPressOrb ?? (() => {})}
            status={orbStatus}
            celebrateKey={celebrateKey}
          />
        </View>
      </View>

      {line ? (
        <Animated.Text
          style={[
            typeStyle('display.line'),
            styles.heroLine,
            { opacity: lineIn, transform: [{ translateY: lineIn.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }] },
          ]}
        >
          {line}
        </Animated.Text>
      ) : null}
    </View>
  );
}

/**
 * MediaCard — a content-type-aware Memory row. Treats content as media: photo→thumbnail, voice→waveform
 * placeholder, doc→cover/favicon, place→map snippet placeholder, person→avatar, text→typed glyph-chip
 * with a per-domain accent. Layout: media-left / title / one-line context / time-right.
 *
 * Props:
 *   kind     — 'photo' | 'voice' | 'doc' | 'place' | 'person' | 'text'
 *   title    — primary line (UI subtitle voice).
 *   context  — one-line supporting context (meta voice), single line.
 *   time     — right-aligned timestamp (meta).
 *   imageUri — for photo (thumbnail) / doc (cover) / place (map snippet) / person (avatar) when present.
 *   icon     — glyph for the text/doc/voice fallback (defaults per kind).
 *   domain   — domain accent key (drives the text glyph-chip + voice waveform color). Default 'note'.
 *   onPress  — tap to open the canonical item.
 *   style    — container style.
 */
export function MediaCard({
  kind,
  title,
  context,
  time,
  imageUri,
  icon,
  domain = 'note',
  onPress,
  style,
}: {
  kind: 'photo' | 'voice' | 'doc' | 'place' | 'person' | 'text';
  title: string;
  context?: string;
  time?: string;
  imageUri?: string;
  icon?: IconNameP5;
  domain?: DomainKey;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const accent = DOMAIN_ACCENT[domain] ?? LUCY_COLORS.textMuted;

  const renderMedia = () => {
    if ((kind === 'photo' || kind === 'doc' || kind === 'place') && imageUri) {
      return <Image source={{ uri: imageUri }} style={styles.mediaThumb} resizeMode="cover" accessibilityIgnoresInvertColors />;
    }
    if (kind === 'person') {
      if (imageUri) return <Image source={{ uri: imageUri }} style={styles.mediaAvatar} resizeMode="cover" accessibilityIgnoresInvertColors />;
      return <Avatar label={(title || '?').slice(0, 1).toUpperCase()} size={48} color={accent} />;
    }
    if (kind === 'voice') {
      // Simple static waveform placeholder (bars). A live waveform is a later-phase upgrade.
      const bars = [10, 18, 26, 16, 22, 12, 20, 14];
      return (
        <View style={[styles.mediaTile, { backgroundColor: withAlpha(accent, 0.12) }]}>
          <View style={styles.waveRow}>
            {bars.map((h, i) => (
              <View key={i} style={[styles.waveBar, { height: h, backgroundColor: accent }]} />
            ))}
          </View>
        </View>
      );
    }
    // text / doc-without-cover / place-without-snippet → typed glyph-chip with domain accent.
    const fallbackIcon =
      icon ??
      (kind === 'doc' ? 'document-text' : kind === 'place' ? 'location' : 'pricetag');
    return (
      <View style={[styles.mediaTile, { backgroundColor: withAlpha(accent, 0.12), borderColor: withAlpha(accent, 0.22) }]}>
        <Ionicons name={fallbackIcon as keyof typeof Ionicons.glyphMap} size={22} color={accent} />
      </View>
    );
  };

  const Wrapper: React.ComponentType<{ children: React.ReactNode }> = onPress
    ? ({ children }) => (
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={[title, context, time].filter(Boolean).join(', ')}
          style={({ pressed }) => [styles.mediaCard, pressed && { backgroundColor: LUCY_COLORS.surfaceRaised }]}
        >
          {children}
        </Pressable>
      )
    : ({ children }) => <View style={styles.mediaCard}>{children}</View>;

  return (
    <Wrapper>
      <View style={[styles.mediaRow, style]}>
        {renderMedia()}
        <View style={styles.mediaBody}>
          <Text style={typeStyle('ui.subtitle')} numberOfLines={1}>{title}</Text>
          {context ? <Text style={[typeStyle('ui.meta'), styles.mediaContext]} numberOfLines={1}>{context}</Text> : null}
        </View>
        {time ? <Text style={[typeStyle('ui.meta'), styles.mediaTime]} numberOfLines={1}>{time}</Text> : null}
      </View>
    </Wrapper>
  );
}

/**
 * DistributionBar — a one-line HUMAN summary by default ("3 things need you today"); tapping reveals a
 * proportional SEGMENTED micro-bar (colored segments + count-up). Not a dot-separated text wall.
 *
 * Props:
 *   summary  — the default human sentence (display? no — UI subtitle; it's data-derived, kept warm-neutral).
 *   segments — [{ label, value, color }]; rendered proportionally on expand with a count-up.
 *   defaultExpanded — start expanded (default false).
 *   onToggle — notified of expand state.
 *   style    — container style.
 */
export function DistributionBar({
  summary,
  segments,
  defaultExpanded = false,
  onToggle,
  style,
}: {
  summary: string;
  segments: Array<{ label: string; value: number; color: string }>;
  defaultExpanded?: boolean;
  onToggle?: (expanded: boolean) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReducedMotion();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const total = segments.reduce((s, seg) => s + Math.max(0, seg.value), 0) || 1;

  const reveal = useRef(new Animated.Value(defaultExpanded ? 1 : 0)).current;
  const [counts, setCounts] = useState<number[]>(() => (defaultExpanded ? segments.map((s) => s.value) : segments.map(() => 0)));

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    onToggle?.(next);
    haptic.expand();
    Animated.timing(reveal, motionConfig({ toValue: next ? 1 : 0, duration: DURATION.base }, reduced)).start();
    if (next) {
      // Count-up each segment value.
      if (reduced) { setCounts(segments.map((s) => s.value)); return; }
      const start = Date.now();
      const dur = DURATION.lazy;
      const tick = () => {
        const p = Math.min(1, (Date.now() - start) / dur);
        const eased = 1 - Math.pow(1 - p, 3);
        setCounts(segments.map((s) => Math.round(s.value * eased)));
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } else {
      setCounts(segments.map(() => 0));
    }
  };

  return (
    <View style={style}>
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${summary}. ${expanded ? 'Hide' : 'Show'} breakdown`}
        style={({ pressed }) => [styles.distRow, pressed && { opacity: 0.7 }]}
      >
        <Text style={[typeStyle('ui.subtitle'), { flex: 1 }]} numberOfLines={2}>{summary}</Text>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={LUCY_COLORS.textSubtle}
        />
      </Pressable>

      {expanded ? (
        <Animated.View style={{ opacity: reveal, marginTop: 12 }}>
          {/* Proportional segmented micro-bar. */}
          <View style={styles.distBar} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {segments.map((seg, i) => {
              const frac = Math.max(0, seg.value) / total;
              return frac > 0 ? <View key={i} style={{ flex: frac, backgroundColor: seg.color }} /> : null;
            })}
          </View>
          {/* Legend with count-up. */}
          <View style={styles.distLegend}>
            {segments.map((seg, i) => (
              <View key={i} style={styles.distLegendItem}>
                <View style={[styles.distDot, { backgroundColor: seg.color }]} />
                <Text style={typeStyle('ui.bodyStrong')}>{counts[i] ?? seg.value}</Text>
                <Text style={[typeStyle('ui.meta'), { marginLeft: 4 }]}>{seg.label}</Text>
              </View>
            ))}
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

/**
 * TeaserCard — a small image/icon-bearing discovery card, visually distinct from a list row (it has a
 * tinted domain-color leading tile, a title, an optional one-line subtitle, and a chevron). For P3
 * real-data teasers ("Lucy logged $42 → Money").
 *
 * Props:
 *   icon     — leading glyph (used when no imageUri).
 *   imageUri — optional leading image (overrides the icon tile).
 *   title    — primary line.
 *   subtitle — optional one-line context.
 *   domain   — domain accent key (default 'note').
 *   onPress  — open the teased item.
 *   style    — container style.
 */
export function TeaserCard({
  icon = 'sparkles',
  imageUri,
  title,
  subtitle,
  domain = 'note',
  onPress,
  style,
}: {
  icon?: IconNameP5;
  imageUri?: string;
  title: string;
  subtitle?: string;
  domain?: DomainKey;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const accent = DOMAIN_ACCENT[domain] ?? LUCY_COLORS.primary;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[title, subtitle].filter(Boolean).join(', ')}
      style={({ pressed }) => [styles.teaserCard, { borderColor: withAlpha(accent, 0.22) }, pressed && { opacity: 0.85 }, style]}
    >
      {imageUri ? (
        <Image source={{ uri: imageUri }} style={styles.teaserImage} resizeMode="cover" accessibilityIgnoresInvertColors />
      ) : (
        <View style={[styles.teaserTile, { backgroundColor: withAlpha(accent, 0.14) }]}>
          <Ionicons name={icon as keyof typeof Ionicons.glyphMap} size={20} color={accent} />
        </View>
      )}
      <View style={styles.teaserBody}>
        <Text style={typeStyle('ui.bodyStrong')} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={typeStyle('ui.meta')} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={withAlpha(accent, 0.8)} />
    </Pressable>
  );
}

/**
 * SwipeRow — wraps any row to add swipe-to-act as an ACCELERATOR (the tap path is preserved). Swiping
 * left reveals/triggers the primary action; an optional secondary action reveals on a right swipe.
 * Haptics fire on threshold crossing + on commit. Reduce-motion: swipe is disabled (tap still works).
 *
 * Built on RN PanResponder + Animated (no gesture-handler/reanimated dep), OTA-safe.
 *
 * Props:
 *   children   — the row content (its own onPress stays the canonical tap path).
 *   leftAction  — revealed on swipe RIGHT (content moves right): { icon, label, color, onAction }.
 *   rightAction — revealed on swipe LEFT (content moves left): { icon, label, color, onAction }.
 *   threshold  — px to drag before the action commits on release (default 96).
 *   style      — container style.
 */
type SwipeAction = { icon: IconNameP5; label: string; color: string; onAction: () => void };
export function SwipeRow({
  children,
  leftAction,
  rightAction,
  threshold = 96,
  style,
}: {
  children: React.ReactNode;
  leftAction?: SwipeAction;
  rightAction?: SwipeAction;
  threshold?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReducedMotion();
  const translateX = useRef(new Animated.Value(0)).current;
  const armed = useRef(false); // crossed threshold (for the threshold haptic)
  const maxReveal = threshold + 40;

  const responder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => {
        if (reduced) return false;
        // Only claim clearly-horizontal drags so vertical scroll still works.
        return Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.4;
      },
      onPanResponderMove: (_e, g) => {
        let dx = g.dx;
        if (dx > 0 && !leftAction) dx = 0;
        if (dx < 0 && !rightAction) dx = 0;
        dx = Math.max(-maxReveal, Math.min(maxReveal, dx));
        translateX.setValue(dx);
        const crossed = Math.abs(dx) >= threshold;
        if (crossed && !armed.current) { armed.current = true; haptic.longPress(); }
        if (!crossed && armed.current) { armed.current = false; }
      },
      onPanResponderRelease: (_e, g) => {
        const committed = Math.abs(g.dx) >= threshold;
        const action = g.dx > 0 ? leftAction : rightAction;
        if (committed && action) {
          haptic.taskDone();
          // Snap back, then fire (so the row settles before content changes).
          Animated.spring(translateX, { toValue: 0, ...SPRING.snap }).start(() => action.onAction());
        } else {
          Animated.spring(translateX, { toValue: 0, ...SPRING.snap }).start();
        }
        armed.current = false;
      },
      onPanResponderTerminate: () => {
        Animated.spring(translateX, { toValue: 0, ...SPRING.snap }).start();
        armed.current = false;
      },
    })
  ).current;

  const renderActionBg = (action: SwipeAction | undefined, side: 'left' | 'right') => {
    if (!action) return null;
    const isLeft = side === 'left';
    const opacity = translateX.interpolate({
      inputRange: isLeft ? [0, threshold] : [-threshold, 0],
      outputRange: isLeft ? [0, 1] : [1, 0],
      extrapolate: 'clamp',
    });
    return (
      <Animated.View
        pointerEvents="none"
        style={[styles.swipeAction, isLeft ? styles.swipeActionLeft : styles.swipeActionRight, { backgroundColor: action.color, opacity }]}
      >
        <Ionicons name={action.icon as keyof typeof Ionicons.glyphMap} size={20} color={LUCY_COLORS.white} />
        <Text style={styles.swipeActionLabel}>{action.label}</Text>
      </Animated.View>
    );
  };

  // Reduce-motion / no actions → just render children (tap path untouched).
  if (reduced || (!leftAction && !rightAction)) {
    return <View style={style}>{children}</View>;
  }

  return (
    <View style={[styles.swipeWrap, style]}>
      {renderActionBg(leftAction, 'left')}
      {renderActionBg(rightAction, 'right')}
      <Animated.View style={{ transform: [{ translateX }] }} {...responder.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
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

  // ── P5: LucyHero ──
  heroWrap: { alignItems: 'center', paddingVertical: 18, gap: 12, overflow: 'hidden' },
  heroWashTop: { position: 'absolute', top: 0, left: -40, right: -40, height: 160, borderBottomLeftRadius: 200, borderBottomRightRadius: 200 },
  heroWashMid: { position: 'absolute', top: 30, left: 0, right: 0, height: 120, borderRadius: 200, opacity: 0.9, transform: [{ scaleX: 1.4 }] },
  heroOrbBox: { alignItems: 'center', justifyContent: 'center' },
  heroHalo: { position: 'absolute' },
  heroLine: { textAlign: 'center', paddingHorizontal: 24, maxWidth: 340 },

  // ── P5: MediaCard ──
  mediaCard: { backgroundColor: LUCY_COLORS.surface, borderRadius: RADIUS.card, paddingHorizontal: 14, paddingVertical: 12, ...LUCY_SHADOWS.sm },
  mediaRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56 },
  mediaThumb: { width: 48, height: 48, borderRadius: 12, backgroundColor: LUCY_COLORS.surfaceRaised },
  mediaAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: LUCY_COLORS.surfaceRaised },
  mediaTile: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'transparent' },
  waveRow: { flexDirection: 'row', alignItems: 'center', gap: 2.5, height: 28 },
  waveBar: { width: 2.5, borderRadius: 2 },
  mediaBody: { flex: 1, gap: 1 },
  mediaContext: { color: LUCY_COLORS.textMuted },
  mediaTime: { color: LUCY_COLORS.textSubtle, marginLeft: 4 },

  // ── P5: DistributionBar ──
  distRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48 },
  distBar: { flexDirection: 'row', height: 10, borderRadius: 999, overflow: 'hidden', backgroundColor: LUCY_COLORS.surfaceRaised },
  distLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 12 },
  distLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  distDot: { width: 9, height: 9, borderRadius: 5 },

  // ── P5: TeaserCard ──
  teaserCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: LUCY_COLORS.surface,
    borderRadius: RADIUS.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    minHeight: 56,
    ...LUCY_SHADOWS.sm,
  },
  teaserTile: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  teaserImage: { width: 40, height: 40, borderRadius: 12, backgroundColor: LUCY_COLORS.surfaceRaised },
  teaserBody: { flex: 1, gap: 1 },

  // ── P5: SwipeRow ──
  swipeWrap: { position: 'relative', overflow: 'hidden', borderRadius: RADIUS.card },
  swipeAction: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 120,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 16,
  },
  swipeActionLeft: { left: 0, justifyContent: 'flex-start' },
  swipeActionRight: { right: 0, justifyContent: 'flex-end' },
  swipeActionLabel: { color: LUCY_COLORS.white, fontWeight: '800', fontSize: 13 },
});
