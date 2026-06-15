import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LUCY_COLORS } from '../config/colors';

type Mood = 'awake' | 'sleeping';
type DayPhase = 'morning' | 'day' | 'evening' | 'night';
type FaceExpression = 'calm' | 'peek' | 'sleeping' | 'listening' | 'organizing' | 'saving' | 'thinking' | 'reading';
export type LucyStatus = 'idle' | 'organizing' | 'listening' | 'saving' | 'sleeping' | 'thinking' | 'reading';

function phaseForHour(hour: number): DayPhase {
  if (hour >= 22 || hour < 6) return 'night';
  if (hour < 11) return 'morning';
  if (hour >= 18) return 'evening';
  return 'day';
}

function moodForPhase(phase: DayPhase): Mood {
  return phase === 'night' ? 'sleeping' : 'awake';
}

const STATUS_META: Record<Exclude<LucyStatus, 'idle'>, { marker: string; label: string }> = {
  organizing: { marker: 'memory', label: 'Organizing' },
  listening: { marker: 'audio', label: 'Listening' },
  saving: { marker: 'saved', label: 'Saving' },
  sleeping: { marker: 'quiet', label: 'Resting' },
  thinking: { marker: 'ask', label: 'Thinking' },
  reading: { marker: 'brief', label: 'Reading' },
};

const PHASE_PALETTE: Record<DayPhase, { orb: string; glow: string; highlight: string; cloud: string; ring: string }> = {
  morning: { orb: '#FFB064', glow: '#FFD09A', highlight: 'rgba(255,248,230,0.72)', cloud: '#2B1D10', ring: '#FFD09A' },
  day: { orb: LUCY_COLORS.primary, glow: LUCY_COLORS.primaryGlow, highlight: 'rgba(255,245,230,0.62)', cloud: '#241A10', ring: LUCY_COLORS.primaryGlow },
  evening: { orb: '#F06F3C', glow: '#FF9B6A', highlight: 'rgba(255,220,190,0.56)', cloud: '#26150F', ring: '#FF9B6A' },
  night: { orb: '#8A5A2B', glow: '#D69A5B', highlight: 'rgba(245,210,170,0.42)', cloud: '#17120D', ring: '#A87949' },
};

const FACE = '#1A1206';

function Particle({ delay, x }: { delay: number; x: number }) {
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.delay(delay),
      Animated.timing(t, { toValue: 1, duration: 2200, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [delay, t]);

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        bottom: 8,
        left: 23 + x,
        width: 3,
        height: 3,
        borderRadius: 1.5,
        backgroundColor: LUCY_COLORS.primaryGlow,
        opacity: t.interpolate({ inputRange: [0, 0.2, 0.8, 1], outputRange: [0, 0.9, 0.6, 0] }),
        transform: [
          { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, -34] }) },
          { translateX: t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, x > 0 ? 4 : -4, 0] }) },
        ],
      }}
    />
  );
}

export function AnimatedFace({
  unreadCount,
  onPress,
  celebrateKey,
  status = 'idle',
}: {
  unreadCount: number;
  onPress: () => void;
  celebrateKey?: number;
  status?: LucyStatus;
}) {
  const [phase, setPhase] = useState<DayPhase>(() => phaseForHour(new Date().getHours()));
  const [mood, setMood] = useState<Mood>(() => moodForPhase(phaseForHour(new Date().getHours())));
  const [peeked, setPeeked] = useState(false);
  const effectiveStatus: LucyStatus = status !== 'idle' ? status : (phase === 'night' ? 'sleeping' : 'idle');
  const palette = PHASE_PALETTE[phase];

  const cloudAnim = useRef(new Animated.Value(0)).current;
  const breathe = useRef(new Animated.Value(0)).current;
  const blink = useRef(new Animated.Value(1)).current;
  const glow = useRef(new Animated.Value(0)).current;
  const zDrift = useRef(new Animated.Value(0)).current;
  const happy = useRef(new Animated.Value(0)).current;
  const shimmer = useRef(new Animated.Value(0)).current;
  const orbit = useRef(new Animated.Value(0)).current;

  const expression: FaceExpression = useMemo(() => {
    if (peeked && effectiveStatus !== 'listening' && effectiveStatus !== 'organizing') return 'peek';
    if (effectiveStatus === 'sleeping') return 'sleeping';
    if (effectiveStatus === 'listening') return 'listening';
    if (effectiveStatus === 'organizing') return 'organizing';
    if (effectiveStatus === 'saving') return 'saving';
    if (effectiveStatus === 'thinking') return 'thinking';
    if (effectiveStatus === 'reading') return 'reading';
    return 'calm';
  }, [effectiveStatus, peeked]);

  useEffect(() => {
    const tick = () => {
      const next = phaseForHour(new Date().getHours());
      setPhase(next);
      if (status === 'idle') setMood(moodForPhase(next));
    };
    tick();
    const timer = setInterval(tick, 60_000);
    return () => clearInterval(timer);
  }, [status]);

  useEffect(() => {
    setMood(effectiveStatus === 'sleeping' ? 'sleeping' : 'awake');
  }, [effectiveStatus]);

  useEffect(() => {
    const loop = Animated.loop(Animated.timing(shimmer, {
      toValue: 1,
      duration: mood === 'sleeping' ? 9000 : 5000,
      easing: Easing.linear,
      useNativeDriver: true,
    }));
    loop.start();
    return () => loop.stop();
  }, [mood, shimmer]);

  useEffect(() => {
    const duration = effectiveStatus === 'listening' ? 1300 : effectiveStatus === 'organizing' ? 2100 : 3600;
    const loop = Animated.loop(Animated.timing(orbit, {
      toValue: 1,
      duration,
      easing: Easing.linear,
      useNativeDriver: true,
    }));
    loop.start();
    return () => loop.stop();
  }, [effectiveStatus, orbit]);

  useEffect(() => {
    Animated.timing(cloudAnim, {
      toValue: effectiveStatus === 'idle' ? 0 : 1,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [cloudAnim, effectiveStatus]);

  useEffect(() => {
    const duration = mood === 'sleeping' ? 2600 : 1700;
    const breatheLoop = Animated.loop(Animated.sequence([
      Animated.timing(breathe, { toValue: 1, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(breathe, { toValue: 0, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    const glowLoop = Animated.loop(Animated.sequence([
      Animated.timing(glow, { toValue: 1, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(glow, { toValue: 0, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    breatheLoop.start();
    glowLoop.start();
    return () => { breatheLoop.stop(); glowLoop.stop(); };
  }, [breathe, glow, mood]);

  useEffect(() => {
    if (mood === 'sleeping') {
      blink.setValue(1);
      return;
    }
    let cancelled = false;
    const scheduleBlink = () => {
      const delay = 2200 + Math.random() * 2600;
      setTimeout(() => {
        if (cancelled) return;
        Animated.sequence([
          Animated.timing(blink, { toValue: 0, duration: 90, useNativeDriver: true }),
          Animated.timing(blink, { toValue: 1, duration: 110, useNativeDriver: true }),
        ]).start(() => { if (!cancelled) scheduleBlink(); });
      }, delay);
    };
    scheduleBlink();
    return () => { cancelled = true; };
  }, [blink, mood]);

  useEffect(() => {
    if (mood !== 'sleeping') return;
    const loop = Animated.loop(Animated.timing(zDrift, {
      toValue: 1,
      duration: 2400,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }));
    loop.start();
    return () => { loop.stop(); zDrift.setValue(0); };
  }, [mood, zDrift]);

  useEffect(() => {
    if (celebrateKey === undefined) return;
    Animated.sequence([
      Animated.timing(happy, { toValue: 1, duration: 160, useNativeDriver: true }),
      Animated.delay(700),
      Animated.timing(happy, { toValue: 0, duration: 240, useNativeDriver: true }),
    ]).start();
  }, [celebrateKey, happy]);

  const scale = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1.06] });
  const glowOpacity = glow.interpolate({ inputRange: [0, 1], outputRange: mood === 'sleeping' ? [0.10, 0.22] : [0.25, 0.5] });
  const orbitRotate = orbit.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const eyeShape = {
    calm: { w: 4, h: 8, radius: 2, leftTilt: '0deg', rightTilt: '0deg', offsetY: 0 },
    peek: { w: 5, h: 10, radius: 3, leftTilt: '0deg', rightTilt: '0deg', offsetY: -1 },
    sleeping: { w: 11, h: 3, radius: 2, leftTilt: '-8deg', rightTilt: '8deg', offsetY: 1 },
    listening: { w: 6, h: 11, radius: 4, leftTilt: '0deg', rightTilt: '0deg', offsetY: -1 },
    organizing: { w: 10, h: 4, radius: 3, leftTilt: '-10deg', rightTilt: '10deg', offsetY: 1 },
    saving: { w: 9, h: 4, radius: 4, leftTilt: '0deg', rightTilt: '0deg', offsetY: 0 },
    thinking: { w: 5, h: 9, radius: 3, leftTilt: '-7deg', rightTilt: '12deg', offsetY: 0 },
    reading: { w: 9, h: 5, radius: 3, leftTilt: '0deg', rightTilt: '0deg', offsetY: 1 },
  }[expression];
  const eyeScaleY = expression === 'sleeping' || expression === 'organizing' || expression === 'saving' || expression === 'reading'
    ? 1
    : Animated.multiply(blink, happy.interpolate({ inputRange: [0, 1], outputRange: [1, 0.35] }));
  const meta = STATUS_META[effectiveStatus as Exclude<LucyStatus, 'idle'>];

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      onPressIn={() => setPeeked(true)}
      onPressOut={() => setPeeked(false)}
      style={styles.touch}
      hitSlop={{ top: 10, bottom: 16, left: 16, right: 16 }}
      accessibilityLabel="LUCY - open notifications"
    >
      <View style={styles.wrap} pointerEvents="none">
        <Animated.View style={[styles.glowOuter, { backgroundColor: palette.glow, opacity: glowOpacity, transform: [{ scale }] }]} />
        <Animated.View style={[styles.glow, { backgroundColor: palette.glow, opacity: glowOpacity, transform: [{ scale }] }]} />
        {effectiveStatus !== 'idle' ? (
          <Animated.View style={[styles.statusOrbit, { borderColor: palette.ring, opacity: glowOpacity, transform: [{ rotate: orbitRotate }, { scale }] }]}>
            <View style={[styles.statusOrbitDot, { backgroundColor: palette.ring }]} />
          </Animated.View>
        ) : null}

        {effectiveStatus !== 'idle' && effectiveStatus !== 'sleeping' ? (
          <>
            <Particle delay={0} x={-6} />
            <Particle delay={700} x={6} />
            <Particle delay={1400} x={0} />
          </>
        ) : null}

        <Animated.View style={[styles.sphere, { backgroundColor: palette.orb, borderColor: palette.highlight, transform: [{ scale }] }]}>
          <Animated.View
            pointerEvents="none"
            style={[styles.shimmer, { transform: [{ rotate: shimmer.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }]}
          />
          <View style={[styles.specular, { backgroundColor: palette.highlight }]} />
          <View style={styles.face}>
            <View style={styles.eyesRow}>
              <Animated.View style={[styles.eye, {
                width: eyeShape.w,
                height: eyeShape.h,
                borderRadius: eyeShape.radius,
                transform: [{ translateY: eyeShape.offsetY }, { rotate: eyeShape.leftTilt }, { scaleY: eyeScaleY as unknown as number }],
              }]} />
              <Animated.View style={[styles.eye, {
                width: eyeShape.w,
                height: eyeShape.h,
                borderRadius: eyeShape.radius,
                transform: [{ translateY: eyeShape.offsetY }, { rotate: eyeShape.rightTilt }, { scaleY: eyeScaleY as unknown as number }],
              }]} />
            </View>
            <View style={[
              styles.mouth,
              expression === 'sleeping' && styles.mouthSleeping,
              expression === 'listening' && styles.mouthListening,
              expression === 'organizing' && styles.mouthFocused,
              expression === 'thinking' && styles.mouthThinking,
              expression === 'saving' && styles.mouthSaving,
              expression === 'reading' && styles.mouthReading,
            ]} />
          </View>
        </Animated.View>

        {mood === 'sleeping' ? (
          <Animated.Text
            style={[
              styles.sleepMark,
              {
                opacity: zDrift.interpolate({ inputRange: [0, 0.2, 0.8, 1], outputRange: [0, 0.75, 0.45, 0] }),
                transform: [
                  { translateY: zDrift.interpolate({ inputRange: [0, 1], outputRange: [4, -14] }) },
                  { translateX: zDrift.interpolate({ inputRange: [0, 1], outputRange: [0, 7] }) },
                ],
              },
            ]}
          >
            z
          </Animated.Text>
        ) : null}

        {effectiveStatus !== 'idle' && meta ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.cloud,
              {
                backgroundColor: palette.cloud,
                opacity: cloudAnim,
                transform: [
                  { scale: cloudAnim.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) },
                  { translateY: cloudAnim.interpolate({ inputRange: [0, 1], outputRange: [4, 0] }) },
                ],
              },
            ]}
          >
            <Text style={styles.cloudMarker}>{meta.marker}</Text>
            <Text style={styles.cloudText} numberOfLines={1}>{meta.label}</Text>
          </Animated.View>
        ) : null}
        {effectiveStatus !== 'idle' ? <Animated.View style={[styles.tailDot1, { opacity: cloudAnim }]} /> : null}

        {unreadCount > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unreadCount > 9 ? '9+' : String(unreadCount)}</Text>
          </View>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  touch: { padding: 12, alignItems: 'center', justifyContent: 'center' },
  wrap: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center' },
  glowOuter: { position: 'absolute', width: 64, height: 64, borderRadius: 32 },
  glow: { position: 'absolute', width: 48, height: 48, borderRadius: 24 },
  statusOrbit: {
    position: 'absolute',
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  statusOrbitDot: { position: 'absolute', top: -2, left: 24, width: 5, height: 5, borderRadius: 3 },
  sphere: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    shadowColor: LUCY_COLORS.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 9,
  },
  shimmer: { position: 'absolute', width: 56, height: 12, backgroundColor: 'rgba(255,235,200,0.35)', top: 14, left: -8 },
  specular: { position: 'absolute', top: 6, left: 8, width: 10, height: 7, borderRadius: 5 },
  face: { alignItems: 'center', justifyContent: 'center', gap: 3 },
  eyesRow: { flexDirection: 'row', gap: 7, minHeight: 12, alignItems: 'center' },
  eye: { backgroundColor: FACE },
  mouth: {
    width: 12,
    height: 6,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    borderWidth: 2,
    borderTopWidth: 0,
    borderColor: FACE,
    marginTop: 1,
  },
  mouthSleeping: { width: 7, height: 2, borderRadius: 1, borderWidth: 0, backgroundColor: FACE },
  mouthListening: { width: 7, height: 8, borderRadius: 5, borderWidth: 2, borderColor: FACE, marginTop: 1 },
  mouthFocused: { width: 11, height: 2, borderRadius: 1, borderWidth: 0, backgroundColor: FACE, marginTop: 3 },
  mouthThinking: { width: 8, height: 5, borderLeftWidth: 0, borderRightWidth: 2, borderTopWidth: 0, borderBottomWidth: 2, borderColor: FACE, borderRadius: 5, transform: [{ rotate: '-12deg' }] },
  mouthSaving: { width: 13, height: 6, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, borderWidth: 2, borderTopWidth: 0, borderColor: FACE, marginTop: 0 },
  mouthReading: { width: 10, height: 2, borderRadius: 1, borderWidth: 0, backgroundColor: FACE, opacity: 0.8, marginTop: 3 },
  sleepMark: { position: 'absolute', top: -8, right: 4, color: LUCY_COLORS.textMuted, fontSize: 11, fontWeight: '900' },
  cloud: {
    position: 'absolute',
    top: -17,
    right: -8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 11,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: 'rgba(255,140,66,0.45)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 8,
  },
  cloudMarker: { color: LUCY_COLORS.primaryGlow, fontSize: 8, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.2 },
  cloudText: { color: LUCY_COLORS.primaryGlow, fontSize: 9, fontWeight: '800', letterSpacing: 0.2, flexShrink: 0 },
  tailDot1: { position: 'absolute', top: 1, right: 5, width: 4, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,140,66,0.45)' },
  badge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    minWidth: 15,
    height: 15,
    borderRadius: 8,
    backgroundColor: '#ef4444',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: LUCY_COLORS.background,
  },
  badgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },
});
