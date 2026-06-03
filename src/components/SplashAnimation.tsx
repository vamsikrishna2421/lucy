import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text } from 'react-native';

export function SplashAnimation({ fadeAnim, visible }: { fadeAnim: Animated.Value; visible: boolean }) {
  const scale     = useRef(new Animated.Value(0.82)).current;
  const opIn      = useRef(new Animated.Value(0)).current;
  const taglineOp = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(opIn,  { toValue: 1, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, friction: 7, tension: 50, useNativeDriver: true }),
      ]),
      Animated.timing(taglineOp, { toValue: 1, duration: 400, delay: 100, useNativeDriver: true }),
    ]).start();
  }, []);

  if (!visible) return null;

  return (
    // Absolutely positioned — never participates in flex layout, never blocks touches when faded
    <Animated.View style={[styles.container, { opacity: fadeAnim }]} pointerEvents="none">
      <Animated.View style={{ opacity: opIn, transform: [{ scale }], alignItems: 'center' }}>
        <Text style={styles.lucyText}>
          LUC<Text style={styles.lucyY}>Y</Text>
        </Text>
        <Animated.Text style={[styles.tagline, { opacity: taglineOp }]}>
          Listen · Understand · Connect · Yield
        </Animated.Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: '#0F0E0B',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
  },
  lucyText: {
    fontSize: 80,
    fontWeight: '900',
    letterSpacing: -4,
    color: '#F5EFE6',
    lineHeight: 90,
  },
  lucyY: {
    color: '#FF8C42',
  },
  tagline: {
    fontSize: 11,
    fontWeight: '700',
    color: '#8A7560',
    letterSpacing: 2.5,
    textTransform: 'uppercase',
    marginTop: 12,
  },
});
