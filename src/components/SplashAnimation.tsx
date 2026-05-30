/**
 * LUCY Eye → Name Reveal Animation
 *
 * Phase 1 (0–1.8s):   L, U, C orbit around Y (the sun/pupil) in eye shape
 * Phase 2 (1.8–2.8s): Planets slow, drift outward, settle in a line → L U C Y
 * Phase 3 (2.8–4s):   Letters expand, transform into full LUCY wordmark
 * Phase 4 (4s+):      LUCY wordmark holds; app loads behind it
 */

import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, StyleSheet, Text, View, Dimensions } from 'react-native';

const { width: SW } = Dimensions.get('window');

// Eye orbit geometry
const CX = SW / 2;
const CY = 130;
const RX = 110;
const RY = 38;

// Final horizontal positions for each letter (L U C Y)
// Y stays at center (CX), L/U/C spread left
const LETTER_SPACING = 58;
const SETTLE_Y = CY;
const FINAL_POSITIONS = [
  { x: CX - LETTER_SPACING * 1.5, y: SETTLE_Y, letter: 'L', color: '#FF8C42' },
  { x: CX - LETTER_SPACING * 0.5, y: SETTLE_Y, letter: 'U', color: '#FFA05C' },
  { x: CX + LETTER_SPACING * 0.5, y: SETTLE_Y, letter: 'C', color: '#FDDCB0' },
  { x: CX + LETTER_SPACING * 1.5, y: SETTLE_Y, letter: 'Y', color: '#FF8C42' },
];

// Starting orbit angles for L, U, C (Y stays fixed at center as sun)
const ORBIT_PHASES = [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3];
const ORBIT_SPEED  = 1.0; // radians per second

type Phase = 'orbit' | 'settle' | 'expand' | 'done';

interface LetterState {
  x: number;
  y: number;
  size: number;
  opacity: number;
  letter: string;
  color: string;
}

export function SplashAnimation({ fadeAnim, visible }: { fadeAnim: Animated.Value; visible: boolean }) {
  const [phase, setPhase] = useState<Phase>('orbit');
  const [orbitAngle, setOrbitAngle] = useState(0);          // shared orbit progress
  const rafRef   = useRef<number>(0);
  const startRef = useRef<number>(0);
  const lastRef  = useRef<number>(0);

  // Animated values for settle + expand phases
  const settleProgress = useRef(new Animated.Value(0)).current;
  const expandProgress = useRef(new Animated.Value(0)).current;
  const wordmarkOpacity = useRef(new Animated.Value(0)).current;
  const wordmarkScale   = useRef(new Animated.Value(0.4)).current;
  const eyeOpacity      = useRef(new Animated.Value(1)).current;
  const sunPulse        = useRef(new Animated.Value(1)).current;

  // Eye open
  const eyeOpen = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    Animated.timing(eyeOpen, { toValue: 1, duration: 500, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    Animated.loop(
      Animated.sequence([
        Animated.timing(sunPulse, { toValue: 1.18, duration: 800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(sunPulse, { toValue: 1,    duration: 800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    ).start();
  }, []);

  // Phase 1: orbit animation via rAF
  useEffect(() => {
    if (phase !== 'orbit') return;
    const ORBIT_DURATION = 1800; // ms

    const tick = (ts: number) => {
      if (!startRef.current) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const delta = lastRef.current ? (ts - lastRef.current) / 1000 : 0;
      lastRef.current = ts;

      setOrbitAngle((prev) => prev + delta * ORBIT_SPEED);

      if (elapsed >= ORBIT_DURATION) {
        setPhase('settle');
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [phase]);

  // Phase 2: settle — planets drift to final positions
  useEffect(() => {
    if (phase !== 'settle') return;
    Animated.timing(settleProgress, {
      toValue: 1,
      duration: 900,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start(() => setPhase('expand'));
  }, [phase]);

  // Phase 3: expand — letters grow into LUCY wordmark
  useEffect(() => {
    if (phase !== 'expand') return;
    Animated.sequence([
      Animated.delay(100),
      Animated.parallel([
        Animated.timing(expandProgress,  { toValue: 1, duration: 400, easing: Easing.in(Easing.quad), useNativeDriver: false }),
        Animated.timing(eyeOpacity,      { toValue: 0, duration: 300, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.spring(wordmarkScale,   { toValue: 1, friction: 6, tension: 80, useNativeDriver: true }),
        Animated.timing(wordmarkOpacity, { toValue: 1, duration: 350, useNativeDriver: true }),
      ]),
    ]).start(() => setPhase('done'));
  }, [phase]);

  // Compute planet positions during orbit
  const planetPositions: LetterState[] = ORBIT_PHASES.map((phase0, i) => {
    const angle = phase0 + orbitAngle;
    const depth = ((CY + RY * Math.sin(angle)) - (CY - RY)) / (2 * RY);
    return {
      x: CX + RX * Math.cos(angle),
      y: CY + RY * Math.sin(angle),
      size: 22 + depth * 6,
      opacity: 0.55 + depth * 0.45,
      letter: FINAL_POSITIONS[i].letter,
      color:  FINAL_POSITIONS[i].color,
    };
  });

  const isOrbit  = phase === 'orbit';
  const isSettle = phase === 'settle' || phase === 'expand' || phase === 'done';

  return (
    <Modal transparent animationType="none" visible={visible} statusBarTranslucent>
    <Animated.View style={[styles.container, { opacity: fadeAnim }]}>

      {/* Eye frame — shown during orbit + settle */}
      <Animated.View style={{ opacity: eyeOpacity }}>
        <Animated.View style={{ transform: [{ scaleY: eyeOpen }] }}>
          {/* Eye outline */}
          <View style={styles.eyeOutline} />
          {/* Iris */}
          <View style={styles.iris} />
          {/* Orbit path */}
          <View style={styles.orbitPath} />

          {/* Sun / Y pupil */}
          <Animated.View style={[styles.sunWrap, { transform: [{ scale: sunPulse }] }]}>
            <View style={styles.sunGlow} />
            <View style={styles.sunCore}>
              <Text style={styles.sunLabel}>Y</Text>
            </View>
          </Animated.View>
        </Animated.View>
      </Animated.View>

      {/* L, U, C planets / letters */}
      {ORBIT_PHASES.map((_, i) => {
        const orbitPos = planetPositions[i];
        const finalPos = FINAL_POSITIONS[i];

        if (isOrbit) {
          // Orbit phase: render at computed orbit position
          return (
            <View
              key={i}
              style={{
                position: 'absolute',
                left:    orbitPos.x - orbitPos.size / 2,
                top:     orbitPos.y - orbitPos.size / 2 + CY - 10,
                width:   orbitPos.size,
                height:  orbitPos.size,
                borderRadius: orbitPos.size / 2,
                backgroundColor: orbitPos.color,
                opacity: orbitPos.opacity,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ fontSize: orbitPos.size * 0.48, fontWeight: '900', color: '#0F0E0B' }}>
                {orbitPos.letter}
              </Text>
            </View>
          );
        }

        if (isSettle) {
          // Settle phase: interpolate from last orbit pos to final pos
          const interpX = settleProgress.interpolate({ inputRange: [0, 1], outputRange: [orbitPos.x, finalPos.x] });
          const interpY = settleProgress.interpolate({ inputRange: [0, 1], outputRange: [orbitPos.y + CY - 10, finalPos.y + CY - 10] });
          const interpSize = settleProgress.interpolate({ inputRange: [0, 1], outputRange: [orbitPos.size, 38] });
          const interpOpacity = phase === 'expand' || phase === 'done'
            ? expandProgress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] })
            : 1;

          return (
            <Animated.View
              key={i}
              style={{
                position: 'absolute',
                left:   Animated.subtract(interpX, Animated.divide(interpSize, 2)) as any,
                top:    Animated.subtract(interpY, Animated.divide(interpSize, 2)) as any,
                width:  interpSize,
                height: interpSize,
                borderRadius: 999,
                backgroundColor: finalPos.color,
                opacity: interpOpacity,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Animated.Text style={{ fontSize: 18, fontWeight: '900', color: '#0F0E0B' }}>
                {finalPos.letter}
              </Animated.Text>
            </Animated.View>
          );
        }

        return null;
      })}

      {/* Y settle bubble (comes from center) */}
      {isSettle && (() => {
        const finalY = FINAL_POSITIONS[3];
        const interpX = settleProgress.interpolate({ inputRange: [0, 1], outputRange: [CX, finalY.x] });
        const interpY = settleProgress.interpolate({ inputRange: [0, 1], outputRange: [CY + CY - 10, finalY.y + CY - 10] });
        const interpSize = settleProgress.interpolate({ inputRange: [0, 1], outputRange: [30, 38] });
        const interpOpacity = phase === 'expand' || phase === 'done'
          ? expandProgress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] })
          : 1;

        return (
          <Animated.View
            style={{
              position: 'absolute',
              left:   Animated.subtract(interpX, Animated.divide(interpSize, 2)) as any,
              top:    Animated.subtract(interpY, Animated.divide(interpSize, 2)) as any,
              width:  interpSize,
              height: interpSize,
              borderRadius: 999,
              backgroundColor: '#FF8C42',
              opacity: interpOpacity,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Animated.Text style={{ fontSize: 18, fontWeight: '900', color: '#0F0E0B' }}>Y</Animated.Text>
          </Animated.View>
        );
      })()}

      {/* LUCY wordmark — expands in after planets settle */}
      <Animated.View style={[styles.wordmarkWrap, { opacity: wordmarkOpacity, transform: [{ scale: wordmarkScale }] }]}>
        <Text style={styles.lucyText}>
          LUC<Text style={styles.lucyY}>Y</Text>
        </Text>
        <Text style={styles.tagline}>Listen · Understand · Connect · Yield</Text>
      </Animated.View>

    </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F0E0B',
    alignItems: 'center',
    zIndex: 999,
  },
  eyeOutline: {
    position: 'absolute',
    width:  RX * 2 + 20,
    height: RY * 2 + 20,
    borderRadius: RY + 10,
    borderWidth: 1,
    borderColor: 'rgba(255,140,66,0.15)',
    left: CX - RX - 10,
    top:  CY - RY - 10,
  },
  iris: {
    position: 'absolute',
    width: 100,
    height: 100,
    borderRadius: 50,
    left: CX - 50,
    top:  CY - 50,
    borderWidth: 1,
    borderColor: 'rgba(255,140,66,0.08)',
    backgroundColor: 'rgba(255,140,66,0.03)',
  },
  orbitPath: {
    position: 'absolute',
    left: CX - RX,
    top:  CY - RY,
    width:  RX * 2,
    height: RY * 2,
    borderRadius: RY,
    borderWidth: 0.4,
    borderColor: 'rgba(255,140,66,0.08)',
  },
  sunWrap: {
    position: 'absolute',
    left: CX - 22,
    top:  CY - 22,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sunGlow: {
    position: 'absolute',
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,140,66,0.2)',
  },
  sunCore: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: '#FF8C42',
    alignItems: 'center', justifyContent: 'center',
    position: 'absolute',
  },
  sunLabel: {
    fontSize: 13, fontWeight: '900', color: '#0F0E0B', lineHeight: 17,
  },
  wordmarkWrap: {
    position: 'absolute',
    top: CY + RY + 60,
    alignItems: 'center',
  },
  lucyText: {
    fontSize: 72,
    fontWeight: '900',
    letterSpacing: -3,
    color: '#F5EFE6',
    lineHeight: 80,
  },
  lucyY: {
    color: '#FF8C42',
  },
  tagline: {
    fontSize: 11,
    fontWeight: '700',
    color: '#8A7560',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginTop: 8,
  },
});
