/**
 * LucyPeek — a small LUCY orb/face that peeks over the top edge of a review card, as if she's
 * hiding behind a wall and peering out to ask the user a question. Purely decorative (pointer-events
 * off); reuses LUCY's brand identity from AnimatedFace (warm amber orb, espresso eyes with catch-light,
 * a soft smile) and LUCY_COLORS tokens. No new deps — RN primitives + Animated (native driver).
 *
 * The orb sits above the card and is clipped at the card line so only the top ~62% shows, selling the
 * "peeking from behind the edge" feel. She blinks, breathes, and her irises gently dart toward the
 * question — a quiet, alive companion, not a cartoon.
 */
import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { LUCY_COLORS } from '../config/colors';

// Match AnimatedFace's eye palette so she reads as the same character.
const EYE_WHITE = '#FBF1E2';
const IRIS = '#241606';
const LID = '#1A1206';

const ORB = 54;          // orb diameter
const SHOW = 0.6;        // fraction of the orb visible above the card edge (rest is "behind" it)

export function LucyPeek() {
  const breathe = useRef(new Animated.Value(0)).current;  // gentle bob + scale (alive at rest)
  const glow = useRef(new Animated.Value(0)).current;     // soft amber halo pulse
  const blink = useRef(new Animated.Value(1)).current;    // 1 = open, 0 = closed
  const gaze = useRef(new Animated.Value(0.5)).current;   // 0 = look left, 1 = look right
  const enter = useRef(new Animated.Value(0)).current;    // pop-up entrance from behind the card

  // Entrance: spring up from behind the card edge, like she just popped her head out.
  useEffect(() => {
    enter.setValue(0);
    Animated.spring(enter, { toValue: 1, tension: 90, friction: 8, useNativeDriver: true }).start();
  }, [enter]);

  // Breathe / soft bob + halo pulse loops.
  useEffect(() => {
    const breatheLoop = Animated.loop(Animated.sequence([
      Animated.timing(breathe, { toValue: 1, duration: 2400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(breathe, { toValue: 0, duration: 2400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    const glowLoop = Animated.loop(Animated.sequence([
      Animated.timing(glow, { toValue: 1, duration: 2400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(glow, { toValue: 0, duration: 2400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    breatheLoop.start();
    glowLoop.start();
    return () => { breatheLoop.stop(); glowLoop.stop(); };
  }, [breathe, glow]);

  // Natural blink with a roomy random gap (occasional double-blink for life).
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

  // Curious idle gaze — irises drift, settling toward the question below now and then.
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.delay(1600),
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
  const glowOpacity = glow.interpolate({ inputRange: [0, 1], outputRange: [0.22, 0.5] });
  const enterY = enter.interpolate({ inputRange: [0, 1], outputRange: [ORB * 0.7, 0] });
  const enterScale = enter.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });

  const irisX = gaze.interpolate({ inputRange: [0, 1], outputRange: [-2, 2] });
  // Eyes look slightly down toward the card/question — she's attentive to what she's asking.
  const irisY = 0.6;
  const eyeScaleY = blink;

  const renderEye = () => (
    <Animated.View style={[styles.eyeWhite, { transform: [{ scaleY: eyeScaleY }] }]}>
      <Animated.View style={[styles.iris, { transform: [{ translateX: irisX }, { translateY: irisY }] }]}>
        <View style={styles.catchLight} />
      </Animated.View>
    </Animated.View>
  );

  return (
    // Clip container: the card sits below; we only show SHOW fraction of the orb so the rest reads
    // as "behind" the card edge. pointerEvents none so swipe/taps pass through to the card.
    <View pointerEvents="none" style={styles.clip}>
      <Animated.View style={[styles.lift, { transform: [{ translateY: enterY }, { scale: enterScale }] }]}>
        {/* Soft amber halo behind the orb */}
        <Animated.View style={[styles.halo, { opacity: glowOpacity, transform: [{ scale }] }]} />
        <Animated.View style={[styles.orb, { transform: [{ translateY: bobY }, { scale }] }]}>
          <View style={styles.specular} />
          <View style={styles.face}>
            <View style={styles.eyesRow}>
              {renderEye()}
              {renderEye()}
            </View>
            <View style={styles.smileWrap}>
              <View style={styles.smileArc} />
            </View>
          </View>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Absolutely positioned so it floats over the card's top edge, centered toward the right.
  clip: {
    position: 'absolute',
    top: -(ORB * SHOW),
    right: 22,
    width: ORB + 28,
    height: ORB * SHOW + 6,  // only the visible peeking slice; the rest is clipped away
    alignItems: 'center',
    overflow: 'hidden',
    zIndex: 5,
  },
  lift: { width: ORB + 28, alignItems: 'center' },
  halo: {
    position: 'absolute',
    top: 0,
    width: ORB + 22,
    height: ORB + 22,
    borderRadius: (ORB + 22) / 2,
    backgroundColor: LUCY_COLORS.primaryGlow,
  },
  orb: {
    width: ORB,
    height: ORB,
    borderRadius: ORB / 2,
    backgroundColor: LUCY_COLORS.primary,
    borderWidth: 1,
    borderColor: 'rgba(255,245,230,0.62)',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 8,
    overflow: 'hidden',
    shadowColor: LUCY_COLORS.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 10,
    elevation: 8,
  },
  specular: { position: 'absolute', top: 7, left: 11, width: 12, height: 8, borderRadius: 6, backgroundColor: 'rgba(255,245,230,0.55)' },
  face: { alignItems: 'center', justifyContent: 'center', gap: 3 },
  eyesRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  eyeWhite: {
    width: 11,
    height: 12.5,
    borderRadius: 6,
    backgroundColor: EYE_WHITE,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  iris: {
    width: 6.5,
    height: 6.5,
    borderRadius: 3.25,
    backgroundColor: IRIS,
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
  },
  catchLight: { width: 2.2, height: 2.2, borderRadius: 1.1, backgroundColor: 'rgba(255,255,255,0.95)', marginTop: 0.8, marginLeft: 0.8 },
  smileWrap: { width: 18, height: 9, alignItems: 'center', justifyContent: 'flex-start', overflow: 'hidden' },
  smileArc: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: LID, backgroundColor: 'transparent', marginTop: -9 },
});
