import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LUCY_COLORS } from '../config/colors';

type Mood = 'awake' | 'happy' | 'sleeping';
export type LucyStatus = 'idle' | 'organizing' | 'listening' | 'saving' | 'sleeping';

function moodForHour(hour: number): Mood {
  if (hour >= 22 || hour < 6) return 'sleeping';
  return 'awake';
}

const STATUS_META: Record<Exclude<LucyStatus, 'idle'>, { emoji: string; label: string }> = {
  organizing: { emoji: '🧠', label: 'Organizing' },
  listening: { emoji: '🎧', label: 'Listening' },
  saving: { emoji: '💾', label: 'Saving' },
  sleeping: { emoji: '😴', label: 'Sleeping' },
};

/**
 * LUCY's animated face — the top-right "attraction piece".
 * A glowing amber sphere with a simple face that:
 *  - breathes (gentle scale pulse) continuously
 *  - blinks periodically while awake
 *  - sleeps at night (closed eyes + drifting "z"), dimmer + slower
 *  - does a brief happy squint when `celebrate` is toggled (e.g. after a capture)
 * Doubles as the notifications button (shows the unread badge, opens on tap).
 */
export function AnimatedFace({
  unreadCount,
  onPress,
  celebrateKey,
  status = 'idle',
}: {
  unreadCount: number;
  onPress: () => void;
  celebrateKey?: number; // change this value to trigger a happy reaction
  status?: LucyStatus;   // drives the status cloud + face mood
}) {
  // Effective status: fall back to "sleeping" at night when nothing else is happening.
  const hour = new Date().getHours();
  const effectiveStatus: LucyStatus = status !== 'idle' ? status : (hour >= 22 || hour < 6 ? 'sleeping' : 'idle');
  const [mood, setMood] = useState<Mood>(() => moodForHour(new Date().getHours()));
  const cloudAnim = useRef(new Animated.Value(0)).current;
  const breathe = useRef(new Animated.Value(0)).current;
  const blink = useRef(new Animated.Value(1)).current; // 1 = open, 0 = closed
  const glow = useRef(new Animated.Value(0)).current;
  const zDrift = useRef(new Animated.Value(0)).current;
  const happy = useRef(new Animated.Value(0)).current;

  // Mood follows the effective status (sleeping when status is sleeping, else awake).
  useEffect(() => {
    setMood(effectiveStatus === 'sleeping' ? 'sleeping' : 'awake');
  }, [effectiveStatus]);

  // Re-evaluate at night boundary every minute (in case status is idle)
  useEffect(() => {
    const t = setInterval(() => setMood(moodForHour(new Date().getHours())), 60_000);
    return () => clearInterval(t);
  }, []);

  // Animate the status cloud in/out
  useEffect(() => {
    Animated.timing(cloudAnim, {
      toValue: effectiveStatus === 'idle' ? 0 : 1,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [effectiveStatus]);

  // Breathing + glow loop (slower when sleeping)
  useEffect(() => {
    const dur = mood === 'sleeping' ? 2600 : 1700;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(breathe, { toValue: 1, duration: dur, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(breathe, { toValue: 0, duration: dur, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    const glowLoop = Animated.loop(Animated.sequence([
      Animated.timing(glow, { toValue: 1, duration: dur, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(glow, { toValue: 0, duration: dur, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    glowLoop.start();
    return () => { loop.stop(); glowLoop.stop(); };
  }, [mood]);

  // Blink loop (awake only)
  useEffect(() => {
    if (mood === 'sleeping') { blink.setValue(1); return; }
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
  }, [mood]);

  // Drifting "z" while sleeping
  useEffect(() => {
    if (mood !== 'sleeping') return;
    const loop = Animated.loop(Animated.timing(zDrift, { toValue: 1, duration: 2400, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => { loop.stop(); zDrift.setValue(0); };
  }, [mood]);

  // Happy reaction on celebrateKey change
  useEffect(() => {
    if (celebrateKey === undefined) return;
    Animated.sequence([
      Animated.timing(happy, { toValue: 1, duration: 160, useNativeDriver: true }),
      Animated.delay(700),
      Animated.timing(happy, { toValue: 0, duration: 240, useNativeDriver: true }),
    ]).start();
  }, [celebrateKey]);

  const scale = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1.06] });
  const glowOpacity = glow.interpolate({ inputRange: [0, 1], outputRange: mood === 'sleeping' ? [0.10, 0.22] : [0.25, 0.5] });
  // While "happy", eyes squint (scaleY down) and we don't blink-override
  const eyeScaleY = mood === 'sleeping'
    ? 0.12
    : Animated.multiply(blink, happy.interpolate({ inputRange: [0, 1], outputRange: [1, 0.35] }));

  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress} style={styles.wrap} accessibilityLabel="LUCY — open notifications">
      {/* outer glow */}
      <Animated.View style={[styles.glow, { opacity: glowOpacity, transform: [{ scale }] }]} />
      {/* sphere */}
      <Animated.View style={[styles.sphere, mood === 'sleeping' && styles.sphereSleeping, { transform: [{ scale }] }]}>
        <View style={styles.face}>
          <View style={styles.eyesRow}>
            <Animated.View style={[styles.eye, { transform: [{ scaleY: eyeScaleY as unknown as number }] }]} />
            <Animated.View style={[styles.eye, { transform: [{ scaleY: eyeScaleY as unknown as number }] }]} />
          </View>
          {/* mouth: smile when awake, small o/flat when sleeping */}
          <View style={[styles.mouth, mood === 'sleeping' && styles.mouthSleeping]} />
        </View>
      </Animated.View>

      {/* status thought-cloud (top-right, grows leftward to stay on-screen) */}
      {effectiveStatus !== 'idle' ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.cloud,
            {
              opacity: cloudAnim,
              transform: [
                { scale: cloudAnim.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) },
                { translateY: cloudAnim.interpolate({ inputRange: [0, 1], outputRange: [4, 0] }) },
              ],
            },
          ]}
        >
          <Text style={styles.cloudEmoji}>{STATUS_META[effectiveStatus].emoji}</Text>
          <Text style={styles.cloudText}>{STATUS_META[effectiveStatus].label}</Text>
        </Animated.View>
      ) : null}
      {/* thought-tail dots from face to cloud */}
      {effectiveStatus !== 'idle' ? (
        <Animated.View style={[styles.tailDot1, { opacity: cloudAnim }]} />
      ) : null}

      {/* unread badge (bottom-right so it doesn't fight the cloud) */}
      {unreadCount > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{unreadCount > 9 ? '9+' : String(unreadCount)}</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

const FACE = '#1A1206';

const styles = StyleSheet.create({
  wrap: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  glow: { position: 'absolute', width: 52, height: 52, borderRadius: 26, backgroundColor: LUCY_COLORS.primary },
  sphere: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: LUCY_COLORS.primary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: LUCY_COLORS.primary, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.7, shadowRadius: 8,
  },
  sphereSleeping: { backgroundColor: '#8A5A2B' },
  face: { alignItems: 'center', justifyContent: 'center', gap: 3 },
  eyesRow: { flexDirection: 'row', gap: 7 },
  eye: { width: 4, height: 8, borderRadius: 2, backgroundColor: FACE },
  mouth: { width: 12, height: 6, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, borderWidth: 2, borderTopWidth: 0, borderColor: FACE, marginTop: 1 },
  mouthSleeping: { width: 7, height: 2, borderRadius: 1, borderWidth: 0, backgroundColor: FACE },
  // Status thought-cloud: anchored to the face's top-right, content grows leftward.
  cloud: {
    position: 'absolute', top: -16, right: -4, flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#241a10', borderRadius: 11,
    paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1, borderColor: 'rgba(255,140,66,0.4)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.4, shadowRadius: 4, elevation: 6,
  },
  cloudEmoji: { fontSize: 10 },
  cloudText: { color: LUCY_COLORS.primaryGlow, fontSize: 9, fontWeight: '800', letterSpacing: 0.2 },
  tailDot1: { position: 'absolute', top: 0, right: 4, width: 4, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,140,66,0.4)' },
  badge: { position: 'absolute', bottom: -2, right: -2, minWidth: 15, height: 15, borderRadius: 8, backgroundColor: '#ef4444', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 3, borderWidth: 1.5, borderColor: LUCY_COLORS.background },
  badgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },
});
