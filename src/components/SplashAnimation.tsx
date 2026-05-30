import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

const CX = 140;      // center x of the orbital system
const CY = 110;      // center y
const RX = 95;       // semi-major axis
const RY = 32;       // semi-minor axis → makes it look elliptical
const TAIL_LEN = 7;  // comet tail dots
const TAIL_STEP = 0.18; // angle gap between tail dots

interface PlanetConfig {
  phase: number;   // starting angle offset in radians
  size: number;    // base planet size
  speed: number;   // orbit speed multiplier
  color: string;
}

const PLANETS: PlanetConfig[] = [
  { phase: 0,                   size: 9,  speed: 1,    color: '#FF8C42' },
  { phase: (Math.PI * 2) / 3,  size: 7,  speed: 1.35, color: '#FFA05C' },
  { phase: (Math.PI * 4) / 3,  size: 6,  speed: 0.75, color: '#FDDCB0' },
];

function useOrbitAngle(phase: number, speed: number) {
  const [angle, setAngle] = useState(phase);
  useEffect(() => {
    let frame = 0;
    const step = () => {
      setAngle((prev) => prev + 0.018 * speed);
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [speed]);
  return angle;
}

function Planet({ config }: { config: PlanetConfig }) {
  const angle = useOrbitAngle(config.phase, config.speed);

  // Ellipse position
  const x = CX + RX * Math.cos(angle);
  const y = CY + RY * Math.sin(angle);

  // Depth cue: planets at bottom (higher y) are "closer" — slightly larger
  const depthFactor = (y - (CY - RY)) / (2 * RY); // 0 (far top) → 1 (near bottom)
  const size = config.size + depthFactor * 4;
  const opacity = 0.55 + depthFactor * 0.45;

  return (
    <>
      {/* Comet tail */}
      {Array.from({ length: TAIL_LEN }).map((_, j) => {
        const ta = angle - (j + 1) * TAIL_STEP;
        const tx = CX + RX * Math.cos(ta);
        const ty = CY + RY * Math.sin(ta);
        const tailDepth = (ty - (CY - RY)) / (2 * RY);
        const tailOpacity = ((1 - (j + 1) / (TAIL_LEN + 1)) * opacity * 0.7);
        const tailSize = Math.max(2, (size - j * 0.9) * 0.75);
        return (
          <View
            key={j}
            style={{
              position: 'absolute',
              left: tx - tailSize / 2,
              top: ty - tailSize / 2,
              width: tailSize,
              height: tailSize,
              borderRadius: tailSize / 2,
              backgroundColor: config.color,
              opacity: tailOpacity * (0.5 + tailDepth * 0.5),
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
          backgroundColor: config.color,
          opacity,
          shadowColor: config.color,
          shadowRadius: 6,
          shadowOpacity: 0.8,
          elevation: 4,
        }}
      />
    </>
  );
}

export function SplashAnimation({ fadeAnim }: { fadeAnim: Animated.Value }) {
  const sunPulse = useRef(new Animated.Value(1)).current;
  const textFade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Sun pulse
    Animated.loop(
      Animated.sequence([
        Animated.timing(sunPulse, { toValue: 1.15, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(sunPulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    ).start();

    // Text fade in after 0.4s
    Animated.timing(textFade, { toValue: 1, duration: 600, delay: 400, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, []);

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
      {/* Orbital system */}
      <View style={styles.orbitArea}>
        {/* Orbit path ellipses (decorative) */}
        <View style={styles.orbitPath} />

        {/* Sun */}
        <Animated.View style={[styles.sun, { transform: [{ scale: sunPulse }] }]}>
          <View style={styles.sunCore} />
          <View style={styles.sunGlow} />
        </Animated.View>

        {/* Planets */}
        {PLANETS.map((planet, i) => (
          <Planet key={i} config={planet} />
        ))}
      </View>

      {/* LUCY wordmark */}
      <Animated.View style={[styles.wordmark, { opacity: textFade }]}>
        <Text style={styles.lucyText}>
          LUC<Text style={styles.lucyY}>Y</Text>
        </Text>
        <Text style={styles.tagline}>Personal AI Assistant</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#0F0E0B',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
  },
  orbitArea: {
    width: CX * 2,
    height: CY * 2,
    position: 'relative',
  },
  orbitPath: {
    position: 'absolute',
    left: CX - RX,
    top: CY - RY,
    width: RX * 2,
    height: RY * 2,
    borderRadius: RX,
    borderWidth: 0.5,
    borderColor: 'rgba(255,140,66,0.12)',
    transform: [{ scaleY: 1 }],
  },
  sun: {
    position: 'absolute',
    left: CX - 20,
    top: CY - 20,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sunCore: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FF8C42',
    position: 'absolute',
  },
  sunGlow: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,140,66,0.25)',
    position: 'absolute',
  },
  wordmark: {
    marginTop: 24,
    alignItems: 'center',
  },
  lucyText: {
    fontSize: 52,
    fontWeight: '900',
    letterSpacing: -2,
    color: '#F5EFE6',
    lineHeight: 58,
  },
  lucyY: {
    color: '#FF8C42',
  },
  tagline: {
    fontSize: 13,
    fontWeight: '500',
    color: '#8A7560',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginTop: 4,
  },
});
