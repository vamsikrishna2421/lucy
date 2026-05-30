/**
 * LUCY Eye Logo Animation
 *
 * Meaning:
 *   Y (Yield)     = the sun/pupil at center — the moment of insight
 *   L (Listen)    = planet 1, orbiting the eye
 *   U (Understand)= planet 2, orbiting the eye
 *   C (Connect)   = planet 3, orbiting the eye
 *   Comet tails   = connecting the dots — LUCY always watching, always linking
 *   Eye shape     = the guardian eye — a second brain that never sleeps
 */

import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

// Eye geometry — very flat ellipse (ratio ~3:1) reads as an eye shape
const CX = 145;  // center x
const CY = 100;  // center y
const RX = 118;  // semi-major axis (wide)
const RY = 40;   // semi-minor axis (narrow) → eye shape

const TAIL_DOTS = 8;
const TAIL_STEP = 0.14;

const PRIMARY = '#FF8C42';
const GLOW    = '#FFA05C';
const DIM     = '#FDDCB0';

interface PlanetConfig {
  phase: number;
  letter: string;
  speed: number;
  color: string;
  size: number;
}

const PLANETS: PlanetConfig[] = [
  { phase: 0,                   letter: 'L', speed: 1,    color: PRIMARY, size: 11 },
  { phase: (Math.PI * 2) / 3,  letter: 'U', speed: 1.3,  color: GLOW,    size: 9  },
  { phase: (Math.PI * 4) / 3,  letter: 'C', speed: 0.78, color: DIM,     size: 8  },
];

function useAnimatedAngle(phase: number, speed: number): number {
  const [angle, setAngle] = useState(phase);
  const rafRef = useRef<number>(0);
  const lastRef = useRef<number>(0);

  useEffect(() => {
    const tick = (ts: number) => {
      const delta = lastRef.current ? (ts - lastRef.current) / 1000 : 0;
      lastRef.current = ts;
      setAngle((prev) => prev + delta * 1.2 * speed);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [speed]);

  return angle;
}

function Planet({ cfg }: { cfg: PlanetConfig }) {
  const angle = useAnimatedAngle(cfg.phase, cfg.speed);
  const x = CX + RX * Math.cos(angle);
  const y = CY + RY * Math.sin(angle);

  // Depth: bottom of orbit (near side of eye) = larger, brighter
  const depth = (y - (CY - RY)) / (2 * RY); // 0→1
  const size  = cfg.size + depth * 4;
  const alpha = 0.5 + depth * 0.5;

  return (
    <>
      {/* Comet tail — traces the eye's orbit */}
      {Array.from({ length: TAIL_DOTS }).map((_, j) => {
        const ta = angle - (j + 1) * TAIL_STEP;
        const tx = CX + RX * Math.cos(ta);
        const ty = CY + RY * Math.sin(ta);
        const tailDepth = (ty - (CY - RY)) / (2 * RY);
        const ts = Math.max(2, (size - j * 1.1) * 0.72);
        const to = ((1 - (j + 1) / (TAIL_DOTS + 2)) * alpha * 0.75) * (0.4 + tailDepth * 0.6);
        return (
          <View
            key={j}
            style={{
              position: 'absolute',
              left: tx - ts / 2,
              top: ty - ts / 2,
              width: ts,
              height: ts,
              borderRadius: ts / 2,
              backgroundColor: cfg.color,
              opacity: to,
            }}
          />
        );
      })}

      {/* Planet body */}
      <View
        style={{
          position: 'absolute',
          left: x - size / 2,
          top: y - size / 2,
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: cfg.color,
          opacity: alpha,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ fontSize: size * 0.55, fontWeight: '900', color: '#0F0E0B', lineHeight: size }}>
          {cfg.letter}
        </Text>
      </View>
    </>
  );
}

export function SplashAnimation({ fadeAnim }: { fadeAnim: Animated.Value }) {
  const sunPulse  = useRef(new Animated.Value(1)).current;
  const textFade  = useRef(new Animated.Value(0)).current;
  const eyeOpen   = useRef(new Animated.Value(0.3)).current;  // eyelid "opening"

  useEffect(() => {
    // Eye "opens" on load
    Animated.timing(eyeOpen, {
      toValue: 1, duration: 800, easing: Easing.out(Easing.cubic), useNativeDriver: true,
    }).start();

    // Sun pulse
    Animated.loop(
      Animated.sequence([
        Animated.timing(sunPulse, { toValue: 1.2, duration: 1000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(sunPulse, { toValue: 1,   duration: 1000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    ).start();

    // Wordmark fades in after eye opens
    Animated.timing(textFade, {
      toValue: 1, duration: 700, delay: 600, easing: Easing.out(Easing.quad), useNativeDriver: true,
    }).start();
  }, []);

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim }]}>

      {/* Eye opening animation wrapper */}
      <Animated.View style={{ transform: [{ scaleY: eyeOpen }] }}>

        {/* Eye outline — the whites of the eye */}
        <View style={styles.eyeOutline} />

        {/* Subtle upper eyelid highlight */}
        <View style={styles.upperLid} />
        <View style={styles.lowerLid} />

        {/* Iris ring */}
        <View style={styles.iris} />

        {/* Orbital canvas */}
        <View style={styles.orbitArea}>

          {/* Faint orbit path */}
          <View style={styles.orbitPath} />

          {/* Planets: L, U, C */}
          {PLANETS.map((cfg, i) => <Planet key={i} cfg={cfg} />)}

          {/* Sun / Pupil — Y (Yield) */}
          <Animated.View style={[styles.sunWrap, { transform: [{ scale: sunPulse }] }]}>
            <View style={styles.sunGlow} />
            <View style={styles.sunCore}>
              <Text style={styles.sunLabel}>Y</Text>
            </View>
          </Animated.View>

        </View>
      </Animated.View>

      {/* LUCY wordmark */}
      <Animated.View style={[styles.wordmark, { opacity: textFade }]}>
        <Text style={styles.lucyText}>
          LUC<Text style={styles.lucyY}>Y</Text>
        </Text>
        <Text style={styles.tagline}>Listen · Understand · Connect · Yield</Text>
      </Animated.View>

    </Animated.View>
  );
}

const CANVAS_W = CX * 2;
const CANVAS_H = CY * 2;
const IRIS_R = 52;

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#0F0E0B',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
  },

  // Eye whites — elongated thin ring
  eyeOutline: {
    position: 'absolute',
    width:  RX * 2 + 18,
    height: RY * 2 + 18,
    borderRadius: RY + 9,
    borderWidth: 1,
    borderColor: 'rgba(255,140,66,0.18)',
    left: CX - RX - 9,
    top:  CY - RY - 9,
  },

  upperLid: {
    position: 'absolute',
    width: RX * 2 + 18,
    height: 2,
    backgroundColor: 'rgba(255,140,66,0.08)',
    left: CX - RX - 9,
    top:  CY - RY - 9,
    borderRadius: 1,
  },
  lowerLid: {
    position: 'absolute',
    width: RX * 2 + 18,
    height: 2,
    backgroundColor: 'rgba(255,140,66,0.08)',
    left: CX - RX - 9,
    top:  CY + RY + 8,
    borderRadius: 1,
  },

  // Iris — soft glowing ring around the pupil
  iris: {
    position: 'absolute',
    width: IRIS_R * 2,
    height: IRIS_R * 2,
    borderRadius: IRIS_R,
    left: CX - IRIS_R,
    top:  CY - IRIS_R,
    borderWidth: 1,
    borderColor: 'rgba(255,140,66,0.1)',
    backgroundColor: 'rgba(255,140,66,0.04)',
  },

  orbitArea: {
    width:  CANVAS_W,
    height: CANVAS_H,
    position: 'relative',
  },

  orbitPath: {
    position: 'absolute',
    left: CX - RX,
    top:  CY - RY,
    width:  RX * 2,
    height: RY * 2,
    borderRadius: RY,
    borderWidth: 0.4,
    borderColor: 'rgba(255,140,66,0.1)',
  },

  // Y — the sun / pupil at center
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
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,140,66,0.22)',
  },
  sunCore: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#FF8C42',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute',
  },
  sunLabel: {
    fontSize: 14,
    fontWeight: '900',
    color: '#0F0E0B',
    lineHeight: 18,
  },

  wordmark: {
    marginTop: 28,
    alignItems: 'center',
  },
  lucyText: {
    fontSize: 48,
    fontWeight: '900',
    letterSpacing: -2,
    color: '#F5EFE6',
    lineHeight: 54,
  },
  lucyY: {
    color: '#FF8C42',
  },
  tagline: {
    fontSize: 10,
    fontWeight: '700',
    color: '#8A7560',
    letterSpacing: 2.5,
    textTransform: 'uppercase',
    marginTop: 6,
  },
});
