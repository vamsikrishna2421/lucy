/**
 * LucyPeek — a small LUCY orb/face that peeks OVER the top edge of a card and GRIPS the lip with both
 * little hands, as if she's pulled herself up to peer out and ask the user something. Purely decorative
 * (pointer-events off); reuses LUCY's brand identity from AnimatedFace (warm amber orb, espresso eyes
 * with catch-light + a curious brow, a soft smile) and LUCY_COLORS tokens. No new deps — RN primitives
 * + Animated (native driver). Direction: IMG_0761 (a character peeking over a panel, both hands curled
 * over the lip).
 *
 * GEOMETRY (the tricky part — two layers):
 *   1) The ORB sits above the card and is clipped at the card line (inner `headClip`, overflow hidden)
 *      so only the head/brows/eyes show above the lip — selling "peeking from behind the edge".
 *   2) The HANDS render IN FRONT and are NOT clipped (outer `frame`, overflow visible). They sit right
 *      at the edge line and their finger capsules extend a few px DOWN onto the card face, with a soft
 *      contact shadow beneath the fingertips, so they read as gripping the lip.
 * The parent cards give this component `overflow: 'visible'` + top room, so nothing is cut off.
 *
 * She blinks, breathes/bobs, her irises gently dart toward the question, and on entrance she springs up
 * while her hands "grip" (a small settle) — a quiet, alive companion, not a cartoon.
 */
import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { LUCY_COLORS, LUCY_FACE_ENABLED } from '../config/colors';

// Match AnimatedFace's eye palette so she reads as the same character.
const EYE_WHITE = '#FBF1E2';
const IRIS = '#241606';
const LID = '#1A1206';

// Lucy's signature warm amber (kept across the light rebrand). The orb, hands, halo + shadow all use it
// so she stays the same warm character — only the surfaces AROUND her are light.
const LUCY_AMBER = '#FAB23A';
const LUCY_AMBER_GLOW = '#FFD78A';

// Warm amber body shading for the hands so they read as the same material as the orb.
const HAND_FILL = LUCY_AMBER;                    // amber palm/fingers
const HAND_EDGE = 'rgba(120,52,15,0.55)';       // soft darker outline so fingers read on the card
const NAIL_HI = 'rgba(255,244,228,0.5)';        // knuckle highlight (top of each finger)

const ORB = 54;                 // orb diameter
const SHOW = 0.64;              // fraction of the orb visible above the card edge (rest is "behind" it)
const HEAD_SLICE = ORB * SHOW;  // visible head height above the lip
const FRAME_W = ORB + 78;       // wide enough to seat a gripping hand outside each side of the head
const FINGER_DROP = 13;         // how far the fingers curl DOWN onto the card face below the lip

export function LucyPeek() {
  const breathe = useRef(new Animated.Value(0)).current;  // gentle bob + scale (alive at rest)
  const glow = useRef(new Animated.Value(0)).current;     // soft amber halo pulse
  const blink = useRef(new Animated.Value(1)).current;    // 1 = open, 0 = closed
  const gaze = useRef(new Animated.Value(0.5)).current;   // 0 = look left, 1 = look right
  const enter = useRef(new Animated.Value(0)).current;    // pop-up entrance from behind the card
  const grip = useRef(new Animated.Value(0)).current;     // hands settle/squeeze as she pulls up

  // Entrance: spring the head up from behind the lip, and let the hands "grip" (a quick settle) as if
  // she just pulled herself up to peek. Borrows squash-on-contact secondary motion from mascot rigs.
  useEffect(() => {
    enter.setValue(0);
    grip.setValue(0);
    Animated.parallel([
      Animated.spring(enter, { toValue: 1, tension: 90, friction: 8, useNativeDriver: true }),
      Animated.sequence([
        Animated.delay(120),
        Animated.spring(grip, { toValue: 1, tension: 150, friction: 6, useNativeDriver: true }),
      ]),
    ]).start();
  }, [enter, grip]);

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

  // Hands: fade/slide in on entrance, then a tiny continuous knuckle-flex tied to the breath so the
  // grip feels alive. enterGrip layers the one-shot "pull up & settle" on top.
  const handsOpacity = enter.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 0.6, 1] });
  const gripSettleY = grip.interpolate({ inputRange: [0, 1], outputRange: [-2.5, 0] });   // hands pull up to the lip
  const gripSqueeze = grip.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] });   // fingers splay back open after the grab
  const fingerFlex = breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.05] }); // subtle living curl

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

  // One gripping hand: a rounded knuckle/palm mass seated on the lip with four finger capsules curling
  // DOWN over the edge onto the card face, a thumb lump on the inner side, plus a soft contact shadow
  // beneath the fingertips. `flip` mirrors it for the other side; `tilt` angles it slightly inward.
  const renderHand = (side: 'left' | 'right') => {
    const flip = side === 'right' ? -1 : 1;
    return (
      <Animated.View
        style={[
          side === 'left' ? styles.handLeft : styles.handRight,
          {
            opacity: handsOpacity,
            transform: [
              { translateY: gripSettleY },
              { scaleX: flip },
              { rotate: side === 'left' ? '-7deg' : '7deg' },
            ],
          },
        ]}
      >
        {/* Soft contact shadow the fingertips cast on the card face — sells "resting on the surface". */}
        <View style={styles.handContactShadow} />
        {/* Knuckle/palm mass that sits on the lip. */}
        <Animated.View style={[styles.knuckle, { transform: [{ scaleX: gripSqueeze }] }]}>
          {/* Thumb lump on the inner-top corner. */}
          <View style={styles.thumb} />
          {/* Soft sheen across the knuckles, matching the orb's specular. */}
          <View style={styles.knuckleSheen} />
        </Animated.View>
        {/* Four fingers curling down over the lip. The group flexes subtly with the breath. */}
        <Animated.View style={[styles.fingers, { transform: [{ scaleX: gripSqueeze }, { scaleY: fingerFlex }] }]}>
          <View style={[styles.finger, styles.fingerA]}><View style={styles.fingerNail} /></View>
          <View style={[styles.finger, styles.fingerB]}><View style={styles.fingerNail} /></View>
          <View style={[styles.finger, styles.fingerC]}><View style={styles.fingerNail} /></View>
          <View style={[styles.finger, styles.fingerD]}><View style={styles.fingerNail} /></View>
        </Animated.View>
      </Animated.View>
    );
  };

  if (!LUCY_FACE_ENABLED) return null;

  return (
    // Outer frame: NOT clipped (hands extend down onto the card). Absolutely positioned over the card's
    // top-right edge. pointerEvents none so swipe/taps pass through to the card underneath.
    <View pointerEvents="none" style={styles.frame}>
      <Animated.View style={[styles.lift, { transform: [{ translateY: enterY }, { scale: enterScale }] }]}>
        {/* Head layer — clipped at the lip so only the top peeks above. */}
        <View style={styles.headClip}>
          {/* Soft amber halo behind the orb */}
          <Animated.View style={[styles.halo, { opacity: glowOpacity, transform: [{ scale }] }]} />
          <Animated.View style={[styles.orb, { transform: [{ translateY: bobY }, { scale }] }]}>
            <View style={styles.specular} />
            <View style={styles.face}>
              {/* Curious brows give the peek its expression (IMG_0761). */}
              <View style={styles.browsRow}>
                <View style={[styles.brow, styles.browLeft]} />
                <View style={[styles.brow, styles.browRight]} />
              </View>
              <View style={styles.eyesRow}>
                {renderEye()}
                {renderEye()}
              </View>
              <View style={styles.smileWrap}>
                <View style={styles.smileArc} />
              </View>
            </View>
          </Animated.View>
        </View>

        {/* Hands layer — rendered IN FRONT of the head, at the lip line, NOT clipped. */}
        {renderHand('left')}
        {renderHand('right')}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Absolutely positioned so it floats over the card's top edge, centered toward the right.
  // overflow visible — the hands curl down past the lip onto the card face.
  frame: {
    position: 'absolute',
    top: -HEAD_SLICE,
    right: 14,
    width: FRAME_W,
    height: HEAD_SLICE + FINGER_DROP + 6,
    alignItems: 'center',
    overflow: 'visible',
    zIndex: 5,
  },
  lift: { width: FRAME_W, height: HEAD_SLICE + FINGER_DROP + 6, alignItems: 'center' },
  // Clips the orb at the lip line: shows only the peeking head-slice, hides the rest "behind" the card.
  headClip: {
    position: 'absolute',
    top: 0,
    width: ORB + 28,
    height: HEAD_SLICE + 2,
    alignItems: 'center',
    overflow: 'hidden',
  },
  halo: {
    position: 'absolute',
    top: 0,
    width: ORB + 22,
    height: ORB + 22,
    borderRadius: (ORB + 22) / 2,
    backgroundColor: LUCY_AMBER_GLOW,
  },
  orb: {
    width: ORB,
    height: ORB,
    borderRadius: ORB / 2,
    backgroundColor: LUCY_AMBER,
    borderWidth: 1,
    borderColor: 'rgba(255,245,230,0.62)',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 6,
    overflow: 'hidden',
    shadowColor: LUCY_AMBER,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 8,
  },
  specular: { position: 'absolute', top: 7, left: 11, width: 12, height: 8, borderRadius: 6, backgroundColor: 'rgba(255,245,230,0.55)' },
  face: { alignItems: 'center', justifyContent: 'center', gap: 2 },
  // Curious brows — two short soft bars lifted at the outer ends for a playful "ooh, look" peek.
  browsRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 1 },
  brow: { width: 9, height: 2.4, borderRadius: 2, backgroundColor: LID },
  browLeft: { transform: [{ rotate: '-12deg' }] },
  browRight: { transform: [{ rotate: '12deg' }] },
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

  // ── Hands ────────────────────────────────────────────────────────────────
  // Each hand is anchored so its knuckle mass sits ON the lip (top: HEAD_SLICE - a hair) and its
  // fingers hang below onto the card. Seated wide — one outside each side of the head.
  handLeft: { position: 'absolute', top: HEAD_SLICE - 7, left: 4, width: 26, alignItems: 'center' },
  handRight: { position: 'absolute', top: HEAD_SLICE - 7, right: 4, width: 26, alignItems: 'center' },

  // Knuckle/palm mound resting on the lip.
  knuckle: {
    width: 24,
    height: 11,
    borderTopLeftRadius: 9,
    borderTopRightRadius: 9,
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
    backgroundColor: HAND_FILL,
    borderWidth: 1,
    borderColor: HAND_EDGE,
    borderBottomWidth: 0,
    overflow: 'hidden',
    zIndex: 2,
  },
  // Thumb lump tucked at the inner-top of the knuckle mass.
  thumb: {
    position: 'absolute',
    top: 1.5,
    right: -2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: HAND_FILL,
    borderWidth: 1,
    borderColor: HAND_EDGE,
  },
  knuckleSheen: { position: 'absolute', top: 2, left: 4, width: 11, height: 3.5, borderRadius: 2, backgroundColor: 'rgba(255,245,230,0.4)' },

  // Four finger capsules curling down over the lip onto the card face.
  fingers: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', marginTop: -2, gap: 0.5 },
  finger: {
    width: 5,
    backgroundColor: HAND_FILL,
    borderWidth: 1,
    borderColor: HAND_EDGE,
    borderTopWidth: 0,
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
    borderTopLeftRadius: 1,
    borderTopRightRadius: 1,
    alignItems: 'center',
  },
  // Outer fingers shorter, middle two longer — natural splayed grip curling over the edge.
  fingerA: { height: FINGER_DROP - 4 },
  fingerB: { height: FINGER_DROP },
  fingerC: { height: FINGER_DROP - 1 },
  fingerD: { height: FINGER_DROP - 5 },
  // Knuckle highlight at the top of each finger where it bends over the lip.
  fingerNail: { width: 2.4, height: 2.4, borderRadius: 1.4, backgroundColor: NAIL_HI, marginTop: 1.5 },

  // Soft contact shadow the fingertips cast on the card face below the grip (local to the hand wrapper:
  // knuckle ~11 tall + fingers hang below, so the tips land ~18-24 down).
  // Soft neutral contact shadow the fingertips cast on the WHITE card face — gentle on the light theme.
  handContactShadow: {
    position: 'absolute',
    top: 16,
    width: 23,
    height: FINGER_DROP,
    borderRadius: 9,
    backgroundColor: 'rgba(26,27,46,0.16)',
    opacity: 0.5,
    zIndex: 0,
  },
});
