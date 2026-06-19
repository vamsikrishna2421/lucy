/**
 * LucyEmptyState — a warm, character-led empty state. Instead of a flat line of text, LUCY's orb
 * appears (breathing, blinking, a soft smile) with a specific, human invitation and an optional CTA
 * chip. Reuses LUCY's brand identity (warm amber orb, espresso eyes with catch-light) from
 * AnimatedFace/LucyPeek, RN primitives + Animated (native driver) only — OTA-safe.
 *
 * Used on the emptiest lists (Tasks, Reminders, Gallery, Ask insights, Needs-Context done) to turn a
 * first impression into a moment of warmth. Additive + presentation-only.
 */
import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LUCY_COLORS } from '../config/colors';

const EYE_WHITE = '#FBF1E2';
const IRIS = '#241606';
const LID = '#1A1206';
const ORB = 64;

/** A small, alive LUCY orb for empty/idle moments — breathes, blinks, holds a soft smile. */
function EmptyOrb() {
  const breathe = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;
  const blink = useRef(new Animated.Value(1)).current;
  const gaze = useRef(new Animated.Value(0.5)).current;
  const enter = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    enter.setValue(0);
    Animated.spring(enter, { toValue: 1, tension: 70, friction: 9, useNativeDriver: true }).start();
  }, [enter]);

  useEffect(() => {
    const loop = (v: Animated.Value, d: number) => Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: d, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: d, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    const b = loop(breathe, 2400);
    const g = loop(glow, 2400);
    b.start(); g.start();
    return () => { b.stop(); g.stop(); };
  }, [breathe, glow]);

  useEffect(() => {
    let cancelled = false;
    const schedule = () => {
      const delay = 2800 + Math.random() * 3200;
      setTimeout(() => {
        if (cancelled) return;
        const seq: Animated.CompositeAnimation[] = [
          Animated.timing(blink, { toValue: 0, duration: 85, easing: Easing.in(Easing.quad), useNativeDriver: true }),
          Animated.timing(blink, { toValue: 1, duration: 130, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        ];
        if (Math.random() < 0.22) {
          seq.push(Animated.delay(90));
          seq.push(Animated.timing(blink, { toValue: 0, duration: 80, easing: Easing.in(Easing.quad), useNativeDriver: true }));
          seq.push(Animated.timing(blink, { toValue: 1, duration: 120, easing: Easing.out(Easing.quad), useNativeDriver: true }));
        }
        Animated.sequence(seq).start(() => { if (!cancelled) schedule(); });
      }, delay);
    };
    schedule();
    return () => { cancelled = true; };
  }, [blink]);

  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.delay(1800),
      Animated.timing(gaze, { toValue: 0.72, duration: 700, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
      Animated.delay(1500),
      Animated.timing(gaze, { toValue: 0.3, duration: 700, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
      Animated.delay(1400),
      Animated.timing(gaze, { toValue: 0.5, duration: 600, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [gaze]);

  const scale = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1.04] });
  const bobY = breathe.interpolate({ inputRange: [0, 1], outputRange: [1.2, -1.2] });
  const glowOpacity = glow.interpolate({ inputRange: [0, 1], outputRange: [0.18, 0.42] });
  const enterScale = enter.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });
  const enterOpacity = enter;
  const irisX = gaze.interpolate({ inputRange: [0, 1], outputRange: [-2, 2] });

  const renderEye = () => (
    <Animated.View style={[styles.eyeWhite, { transform: [{ scaleY: blink }] }]}>
      <Animated.View style={[styles.iris, { transform: [{ translateX: irisX }] }]}>
        <View style={styles.catchLight} />
      </Animated.View>
    </Animated.View>
  );

  return (
    <Animated.View style={{ opacity: enterOpacity, transform: [{ scale: enterScale }] }}>
      <View style={styles.orbWrap}>
        <Animated.View style={[styles.halo, { opacity: glowOpacity, transform: [{ scale }] }]} />
        <Animated.View style={[styles.orb, { transform: [{ translateY: bobY }, { scale }] }]}>
          <View style={styles.specular} />
          <View style={styles.face}>
            <View style={styles.eyesRow}>
              {renderEye()}
              {renderEye()}
            </View>
            <View style={styles.smileWrap}><View style={styles.smileArc} /></View>
          </View>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

export function LucyEmptyState({
  title,
  message,
  ctaLabel,
  onCta,
  compact,
}: {
  title: string;
  message?: string;
  ctaLabel?: string;
  onCta?: () => void;
  /** Tighter vertical rhythm for empty states inside smaller cards. */
  compact?: boolean;
}) {
  return (
    <View style={[styles.container, compact && styles.containerCompact]}>
      <EmptyOrb />
      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {ctaLabel && onCta ? (
        <TouchableOpacity activeOpacity={0.85} style={styles.cta} onPress={onCta}>
          <Text style={styles.ctaText}>{ctaLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: 30,
    paddingHorizontal: 24,
    backgroundColor: LUCY_COLORS.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: LUCY_COLORS.borderSoft,
    marginBottom: 16,
  },
  containerCompact: { paddingVertical: 22 },
  title: { color: LUCY_COLORS.textDark, fontSize: 16, fontWeight: '900', textAlign: 'center', marginTop: 16, letterSpacing: -0.2 },
  message: { color: LUCY_COLORS.textMuted, fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 7, maxWidth: 300 },
  cta: {
    marginTop: 16,
    backgroundColor: LUCY_COLORS.primarySoft,
    borderWidth: 1,
    borderColor: LUCY_COLORS.primaryLine,
    borderRadius: 999,
    paddingVertical: 9,
    paddingHorizontal: 18,
  },
  ctaText: { color: LUCY_COLORS.primaryGlow, fontSize: 13, fontWeight: '800' },

  // Orb
  orbWrap: { width: ORB + 24, height: ORB + 24, alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', width: ORB + 18, height: ORB + 18, borderRadius: (ORB + 18) / 2, backgroundColor: LUCY_COLORS.primaryGlow },
  orb: {
    width: ORB, height: ORB, borderRadius: ORB / 2,
    backgroundColor: LUCY_COLORS.primary,
    borderWidth: 1, borderColor: 'rgba(255,245,230,0.62)',
    alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 12,
    overflow: 'hidden',
    shadowColor: LUCY_COLORS.primary, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 12, elevation: 8,
  },
  specular: { position: 'absolute', top: 9, left: 14, width: 14, height: 9, borderRadius: 7, backgroundColor: 'rgba(255,245,230,0.55)' },
  face: { alignItems: 'center', justifyContent: 'center', gap: 4 },
  eyesRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  eyeWhite: { width: 13, height: 14.5, borderRadius: 7, backgroundColor: EYE_WHITE, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  iris: { width: 7.5, height: 7.5, borderRadius: 3.75, backgroundColor: IRIS, alignItems: 'flex-start', justifyContent: 'flex-start' },
  catchLight: { width: 2.6, height: 2.6, borderRadius: 1.3, backgroundColor: 'rgba(255,255,255,0.95)', marginTop: 1, marginLeft: 1 },
  smileWrap: { width: 22, height: 11, alignItems: 'center', justifyContent: 'flex-start', overflow: 'hidden' },
  smileArc: { width: 22, height: 22, borderRadius: 11, borderWidth: 2.2, borderColor: LID, backgroundColor: 'transparent', marginTop: -11 },
});
