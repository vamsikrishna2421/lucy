import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LUCY_COLORS } from '../config/colors';

type Mood = 'awake' | 'sleeping';
type DayPhase = 'morning' | 'day' | 'evening' | 'night';
type FaceExpression = 'calm' | 'peek' | 'sleeping' | 'listening' | 'speaking' | 'organizing' | 'saving' | 'thinking' | 'reading' | 'music';
// Public API: the original 8 values are preserved; 'music' is an ADDITIVE optional value.
// Unknown/unspecified statuses fall back to 'idle' geometry, so existing callers are safe.
export type LucyStatus = 'idle' | 'organizing' | 'listening' | 'speaking' | 'saving' | 'sleeping' | 'thinking' | 'reading' | 'music';

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
  speaking: { marker: 'voice', label: 'Speaking' },
  saving: { marker: 'saved', label: 'Saving' },
  sleeping: { marker: 'quiet', label: 'Resting' },
  thinking: { marker: 'ask', label: 'Thinking' },
  reading: { marker: 'brief', label: 'Reading' },
  music: { marker: 'tune', label: 'Listening' },
};

const PHASE_PALETTE: Record<DayPhase, { orb: string; glow: string; highlight: string; cloud: string; ring: string }> = {
  morning: { orb: '#FFB064', glow: '#FFD09A', highlight: 'rgba(255,248,230,0.72)', cloud: '#2B1D10', ring: '#FFD09A' },
  day: { orb: LUCY_COLORS.primary, glow: LUCY_COLORS.primaryGlow, highlight: 'rgba(255,245,230,0.62)', cloud: '#241A10', ring: LUCY_COLORS.primaryGlow },
  evening: { orb: '#F06F3C', glow: '#FF9B6A', highlight: 'rgba(255,220,190,0.56)', cloud: '#26150F', ring: '#FF9B6A' },
  night: { orb: '#8A5A2B', glow: '#D69A5B', highlight: 'rgba(245,210,170,0.42)', cloud: '#17120D', ring: '#A87949' },
};

// Deep warm-brown for the eye whites/lids — reads as a friendly dark eye on the amber orb.
const EYE_WHITE = '#FBF1E2';   // warm cream "sclera"
const IRIS = '#241606';        // deep espresso iris
const LID = '#1A1206';         // closed-lid / sleeping stroke

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
  // Ambient idle showcase — Lucy gently cycles through her personality at rest (daytime only).
  // This is internal state driven by a timer; it never changes what callers pass.
  const [showcase, setShowcase] = useState<FaceExpression>('calm');
  const effectiveStatus: LucyStatus = status !== 'idle' ? status : (phase === 'night' ? 'sleeping' : 'idle');
  const palette = PHASE_PALETTE[phase];

  const cloudAnim = useRef(new Animated.Value(0)).current;
  const breathe = useRef(new Animated.Value(0)).current;
  const blink = useRef(new Animated.Value(1)).current;     // 1 = eyes fully open, 0 = closed
  const glow = useRef(new Animated.Value(0)).current;
  const zDrift = useRef(new Animated.Value(0)).current;
  const happy = useRef(new Animated.Value(0)).current;     // 0 = neutral, 1 = warm smile reaction
  const shimmer = useRef(new Animated.Value(0)).current;
  const orbit = useRef(new Animated.Value(0)).current;
  const gaze = useRef(new Animated.Value(0)).current;      // iris horizontal drift / scan
  const gazeUp = useRef(new Animated.Value(0)).current;    // iris vertical glance (thinking)
  const pulse = useRef(new Animated.Value(0)).current;     // attentive pulse (listening) / talk (speaking)
  const snore = useRef(new Animated.Value(0)).current;     // slow breath cycle for the snore puff bubble
  const bob = useRef(new Animated.Value(0)).current;       // gentle head-bob (music) / nod cadence
  const propIn = useRef(new Animated.Value(0)).current;    // accessory (glasses/headphones/bubble) entrance
  const sparkle = useRef(new Animated.Value(0)).current;   // celebrate sparkle burst
  const note0 = useRef(new Animated.Value(0)).current;     // floating music notes
  const note1 = useRef(new Animated.Value(0)).current;
  const note2 = useRef(new Animated.Value(0)).current;

  const expression: FaceExpression = useMemo(() => {
    if (peeked && effectiveStatus !== 'listening' && effectiveStatus !== 'organizing') return 'peek';
    if (effectiveStatus === 'sleeping') return 'sleeping';
    if (effectiveStatus === 'listening') return 'listening';
    if (effectiveStatus === 'speaking') return 'speaking';
    if (effectiveStatus === 'organizing') return 'organizing';
    if (effectiveStatus === 'saving') return 'saving';
    if (effectiveStatus === 'thinking') return 'thinking';
    if (effectiveStatus === 'reading') return 'reading';
    if (effectiveStatus === 'music') return 'music';
    // Idle + awake → ambient showcase step (calm by default).
    return showcase;
  }, [effectiveStatus, peeked, showcase]);

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
    const duration = effectiveStatus === 'listening' ? 1300 : effectiveStatus === 'speaking' ? 1800 : effectiveStatus === 'organizing' ? 2100 : 3600;
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
    const duration = mood === 'sleeping' ? 2600 : effectiveStatus === 'speaking' ? 1800 : effectiveStatus === 'idle' ? 2400 : 1700;
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
  }, [breathe, glow, mood, effectiveStatus]);

  // Natural blink — quick close→open with a roomy random gap. Eyes default OPEN (blink resting at 1).
  useEffect(() => {
    if (mood === 'sleeping') {
      // Sleeping: gently settle lids shut and keep them peacefully closed.
      Animated.timing(blink, { toValue: 0, duration: 600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }).start();
      return;
    }
    blink.setValue(1);
    let cancelled = false;
    const scheduleBlink = () => {
      const delay = 2600 + Math.random() * 3200;
      setTimeout(() => {
        if (cancelled) return;
        // Occasional double-blink for life.
        const doubles = Math.random() < 0.22;
        const seq: Animated.CompositeAnimation[] = [
          Animated.timing(blink, { toValue: 0, duration: 85, easing: Easing.in(Easing.quad), useNativeDriver: true }),
          Animated.timing(blink, { toValue: 1, duration: 130, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        ];
        if (doubles) {
          seq.push(Animated.delay(90));
          seq.push(Animated.timing(blink, { toValue: 0, duration: 80, easing: Easing.in(Easing.quad), useNativeDriver: true }));
          seq.push(Animated.timing(blink, { toValue: 1, duration: 120, easing: Easing.out(Easing.quad), useNativeDriver: true }));
        }
        Animated.sequence(seq).start(() => { if (!cancelled) scheduleBlink(); });
      }, delay);
    };
    scheduleBlink();
    return () => { cancelled = true; };
  }, [blink, mood]);

  // Iris life: idle = slow curious drift; reading = steady left↔right scan; thinking = glance up.
  useEffect(() => {
    gaze.stopAnimation();
    gazeUp.stopAnimation();
    let loop: Animated.CompositeAnimation | null = null;

    // Drive off `expression` so it follows both real statuses AND the ambient idle showcase.
    if (expression === 'reading') {
      loop = Animated.loop(Animated.sequence([
        Animated.timing(gaze, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
        Animated.delay(120),
        Animated.timing(gaze, { toValue: 0, duration: 360, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.delay(220),
      ]));
      Animated.timing(gazeUp, { toValue: 0.15, duration: 300, useNativeDriver: true }).start();
    } else if (expression === 'thinking') {
      Animated.timing(gazeUp, { toValue: 1, duration: 520, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
      loop = Animated.loop(Animated.sequence([
        Animated.timing(gaze, { toValue: 0.7, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(gaze, { toValue: 0.3, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]));
    } else if (expression === 'organizing' || expression === 'saving') {
      Animated.timing(gazeUp, { toValue: 0, duration: 300, useNativeDriver: true }).start();
      loop = Animated.loop(Animated.sequence([
        Animated.timing(gaze, { toValue: 0.85, duration: 700, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
        Animated.timing(gaze, { toValue: 0.15, duration: 700, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
      ]));
    } else if ((expression === 'calm' || expression === 'peek') && mood !== 'sleeping') {
      Animated.timing(gazeUp, { toValue: 0, duration: 400, useNativeDriver: true }).start();
      loop = Animated.loop(Animated.sequence([
        Animated.delay(1800),
        Animated.timing(gaze, { toValue: 0.72, duration: 700, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
        Animated.delay(1400),
        Animated.timing(gaze, { toValue: 0.5, duration: 600, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
        Animated.delay(1600),
        Animated.timing(gaze, { toValue: 0.28, duration: 700, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
        Animated.delay(1400),
        Animated.timing(gaze, { toValue: 0.5, duration: 600, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
      ]));
    } else if (expression === 'music') {
      // Music: eyes relaxed/centered, sway gently side to side with the beat.
      Animated.timing(gazeUp, { toValue: 0, duration: 300, useNativeDriver: true }).start();
      loop = Animated.loop(Animated.sequence([
        Animated.timing(gaze, { toValue: 0.66, duration: 720, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(gaze, { toValue: 0.34, duration: 720, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]));
    } else {
      // listening / speaking / sleeping: centered, attentive.
      Animated.timing(gaze, { toValue: 0.5, duration: 300, useNativeDriver: true }).start();
      Animated.timing(gazeUp, { toValue: 0, duration: 300, useNativeDriver: true }).start();
    }

    loop?.start();
    return () => loop?.stop();
  }, [expression, mood, gaze, gazeUp]);

  // Attentive pulse (listening) and talk cadence (speaking).
  useEffect(() => {
    pulse.stopAnimation();
    pulse.setValue(0);
    let loop: Animated.CompositeAnimation | null = null;
    if (effectiveStatus === 'listening') {
      loop = Animated.loop(Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 620, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 620, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]));
    } else if (effectiveStatus === 'speaking') {
      loop = Animated.loop(Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 200, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.7, duration: 150, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 220, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]));
    } else if (expression === 'thinking') {
      // Keeps the thought-bubble dots gently cycling (covers showcase-thinking too).
      loop = Animated.loop(Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 560, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 560, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]));
    }
    loop?.start();
    return () => loop?.stop();
  }, [effectiveStatus, expression, pulse]);

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

  // Snore breath cycle — slow inflate→hold→deflate for the sleeping puff bubble.
  useEffect(() => {
    if (mood !== 'sleeping') { snore.setValue(0); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(snore, { toValue: 1, duration: 1700, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.delay(160),
      Animated.timing(snore, { toValue: 0, duration: 1500, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.delay(420),
    ]));
    loop.start();
    return () => { loop.stop(); snore.setValue(0); };
  }, [mood, snore]);

  // Gentle head-bob: lively for music, soft nod while listening; still otherwise.
  useEffect(() => {
    bob.stopAnimation();
    bob.setValue(0);
    let loop: Animated.CompositeAnimation | null = null;
    if (expression === 'music') {
      loop = Animated.loop(Animated.sequence([
        Animated.timing(bob, { toValue: 1, duration: 360, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(bob, { toValue: -1, duration: 360, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]));
    } else if (effectiveStatus === 'listening') {
      loop = Animated.loop(Animated.sequence([
        Animated.timing(bob, { toValue: 0.5, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(bob, { toValue: -0.4, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]));
    }
    loop?.start();
    return () => loop?.stop();
  }, [effectiveStatus, expression, bob]);

  // Accessory entrance — glasses/headphones/thought-bubble pop in when their state begins.
  useEffect(() => {
    const wantsProp = expression === 'reading' || expression === 'music' || expression === 'thinking';
    Animated.spring(propIn, {
      toValue: wantsProp ? 1 : 0,
      tension: 80,
      friction: 9,
      useNativeDriver: true,
    }).start();
  }, [expression, propIn]);

  // Floating musical notes rise while in the music state (real status or showcase).
  useEffect(() => {
    if (expression !== 'music') return;
    const make = (v: Animated.Value, delay: number) => Animated.loop(Animated.sequence([
      Animated.delay(delay),
      Animated.timing(v, { toValue: 1, duration: 1800, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: true }),
    ]));
    const loops = [make(note0, 0), make(note1, 600), make(note2, 1200)];
    loops.forEach(l => l.start());
    return () => { loops.forEach(l => l.stop()); note0.setValue(0); note1.setValue(0); note2.setValue(0); };
  }, [expression, note0, note1, note2]);

  useEffect(() => {
    if (celebrateKey === undefined) return;
    sparkle.setValue(0);
    Animated.parallel([
      Animated.sequence([
        Animated.timing(happy, { toValue: 1, duration: 200, easing: Easing.out(Easing.back(2)), useNativeDriver: true }),
        Animated.delay(750),
        Animated.timing(happy, { toValue: 0, duration: 300, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      ]),
      Animated.timing(sparkle, { toValue: 1, duration: 1050, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start();
  }, [celebrateKey, happy, sparkle]);

  // ── Ambient idle showcase ─────────────────────────────────────────────────
  // At rest (idle + daytime/awake, not peeked) Lucy gently rotates through her
  // personality: calm smile → reading → thinking → music → a little happy/sparkle
  // beat → back to calm. A real status pauses the cycle (the expression memo shows
  // the real state immediately); when idle resumes we hold a calm beat then restart.
  const isShowcasing = effectiveStatus === 'idle' && mood !== 'sleeping' && !peeked;
  useEffect(() => {
    if (!isShowcasing) {
      // Real status (or night/peek) took over — pause and reset to calm so the next
      // resume starts from a settled, smiling beat.
      setShowcase('calm');
      return;
    }
    // Each step is [expression, dwell-ms]. The transition between steps is carried
    // by the existing per-expression animations (prop entrance springs, gaze, bob).
    const SEQUENCE: Array<[FaceExpression, number]> = [
      ['calm', 5000],      // settle on the warm resting smile
      ['reading', 5000],   // glasses + scanning eyes
      ['thinking', 4500],  // thought bubble + glance up
      ['music', 5500],     // headphones + notes + head-bob
      ['calm', 3200],      // brief calm, then a happy sparkle beat fires below
    ];
    let idx = 0;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const step = () => {
      if (cancelled) return;
      const [expr, dwell] = SEQUENCE[idx];
      setShowcase(expr);
      // On the final calm beat, give a charming little happy + sparkle flourish.
      const isHappyBeat = idx === SEQUENCE.length - 1;
      if (isHappyBeat) {
        sparkle.setValue(0);
        Animated.parallel([
          Animated.sequence([
            Animated.timing(happy, { toValue: 1, duration: 220, easing: Easing.out(Easing.back(2)), useNativeDriver: true }),
            Animated.delay(900),
            Animated.timing(happy, { toValue: 0, duration: 320, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
          ]),
          Animated.timing(sparkle, { toValue: 1, duration: 1100, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        ]).start();
      }
      idx = (idx + 1) % SEQUENCE.length;
      timer = setTimeout(step, dwell);
    };

    // Brief calm beat before the cycle gets going (also the resume-from-real-status beat).
    setShowcase('calm');
    timer = setTimeout(step, 1500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [isShowcasing, happy, sparkle]);

  const scale = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1.06] });
  const glowOpacity = glow.interpolate({
    inputRange: [0, 1],
    outputRange: mood === 'sleeping' ? [0.10, 0.22] : effectiveStatus === 'speaking' ? [0.45, 0.75] : [0.25, 0.5],
  });
  const orbitRotate = orbit.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  // ── Eye geometry per expression ──────────────────────────────────────────
  // All states keep a real, OPEN, rounded eye except `sleeping` (lids drawn separately).
  // base = how round/tall the open eye sits; the iris rides inside it.
  const eyeShape = {
    calm: { w: 8.5, h: 9.5, radius: 4.5, gap: 8, offsetY: 0, irisScale: 1 },
    peek: { w: 9.5, h: 11, radius: 5.5, gap: 8, offsetY: -0.5, irisScale: 1.05 },
    sleeping: { w: 10, h: 9, radius: 4.5, gap: 8, offsetY: 0.5, irisScale: 1 },
    listening: { w: 9.5, h: 11.5, radius: 5.5, gap: 8.5, offsetY: -0.5, irisScale: 1.08 },
    speaking: { w: 8.5, h: 10, radius: 4.5, gap: 8, offsetY: 0, irisScale: 1 },
    organizing: { w: 8, h: 9, radius: 4, gap: 7.5, offsetY: 0, irisScale: 0.92 },
    saving: { w: 8.5, h: 9.5, radius: 4.5, gap: 8, offsetY: 0, irisScale: 1 },
    thinking: { w: 8.5, h: 9, radius: 4.2, gap: 8, offsetY: -0.5, irisScale: 0.95 },
    reading: { w: 9, h: 9, radius: 4.5, gap: 8, offsetY: 0.5, irisScale: 0.95 },
    music: { w: 8.5, h: 9.5, radius: 4.5, gap: 8, offsetY: 0, irisScale: 1 },
  }[expression];

  // Blink + happy both squeeze eye height — but only momentarily. Resting = fully open.
  // happy adds a gentle squint (warm smile crinkle), never a flat line.
  const eyeScaleY: Animated.AnimatedInterpolation<number> = Animated.multiply(
    blink,
    happy.interpolate({ inputRange: [0, 1], outputRange: [1, 0.55] })
  ) as unknown as Animated.AnimatedInterpolation<number>;

  // Iris travel within the eye (px). gaze 0→1 = look left→right; gazeUp 0→1 = look up.
  const irisX = gaze.interpolate({ inputRange: [0, 1], outputRange: [-2.1, 2.1] });
  const irisY = gazeUp.interpolate({ inputRange: [0, 1], outputRange: [0.5, -2.6] });

  // Listening: gentle attentive scale on the eye; speaking handled by mouth.
  const attentiveScale = effectiveStatus === 'listening'
    ? pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] })
    : 1;

  const isSleeping = expression === 'sleeping';
  const meta = STATUS_META[effectiveStatus as Exclude<LucyStatus, 'idle'>];

  // Mouth talk motion for speaking (height + slight scale).
  const mouthSpeakScale = effectiveStatus === 'speaking'
    ? pulse.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1.25] })
    : 1;

  // Gentle head-bob (music = lively, listening = soft) nudges the whole face.
  const bobY = bob.interpolate({ inputRange: [-1, 0, 1], outputRange: [1.6, 0, -1.6] });
  const bobTilt = bob.interpolate({ inputRange: [-1, 0, 1], outputRange: ['-3deg', '0deg', '3deg'] });

  // The warm idle smile widens on celebrate; held as a curved arc (see styles.smile*).
  const smileScale = happy.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] });
  const smileLift = happy.interpolate({ inputRange: [0, 1], outputRange: [0, -0.5] });

  // Snore puff: a small bubble that inflates/deflates on the breath cycle while asleep.
  const puffScale = snore.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] });
  const puffOpacity = snore.interpolate({ inputRange: [0, 0.25, 1], outputRange: [0, 0.5, 0.85] });

  // Accessory entrance transforms (glasses/headphones/thought bubble).
  const propScale = propIn.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });
  const propDrop = propIn.interpolate({ inputRange: [0, 1], outputRange: [-3, 0] });

  // A warm visible smile is Lucy's resting mouth for the calm/peek/saving/music states.
  const smilingExpr = expression === 'calm' || expression === 'peek' || expression === 'saving' || expression === 'music';

  // Celebrate sparkles — four little stars that fly out and fade on celebrateKey.
  const SPARKLES = [
    { dx: -20, dy: -18 }, { dx: 22, dy: -14 }, { dx: -16, dy: 16 }, { dx: 18, dy: 18 },
  ];
  const sparkleNodes = SPARKLES.map((s, i) => (
    <Animated.View
      key={i}
      pointerEvents="none"
      style={[
        styles.sparkle,
        {
          opacity: sparkle.interpolate({ inputRange: [0, 0.2, 0.7, 1], outputRange: [0, 1, 1, 0] }),
          transform: [
            { translateX: sparkle.interpolate({ inputRange: [0, 1], outputRange: [0, s.dx] }) },
            { translateY: sparkle.interpolate({ inputRange: [0, 1], outputRange: [0, s.dy] }) },
            { scale: sparkle.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.2, 1.1, 0.4] }) },
            { rotate: sparkle.interpolate({ inputRange: [0, 1], outputRange: ['0deg', i % 2 ? '90deg' : '-90deg'] }) },
          ],
        },
      ]}
    />
  ));

  function renderEye(side: 'left' | 'right') {
    if (isSleeping) {
      // Peaceful closed lid: a soft downward curve. Tilt mirrors per side for a content arc.
      return (
        <View style={[styles.lid, { transform: [{ rotate: side === 'left' ? '8deg' : '-8deg' }] }]} />
      );
    }
    return (
      <Animated.View
        style={[
          styles.eyeWhite,
          {
            width: eyeShape.w,
            height: eyeShape.h,
            borderRadius: eyeShape.radius,
            transform: [
              { translateY: eyeShape.offsetY },
              { scale: attentiveScale },
              { scaleY: eyeScaleY },
            ],
          },
        ]}
      >
        {/* Iris + pupil ride inside; catch-light highlight sells "alive". */}
        <Animated.View
          style={[
            styles.iris,
            {
              transform: [
                { translateX: irisX },
                { translateY: irisY },
                { scale: eyeShape.irisScale },
              ],
            },
          ]}
        >
          <View style={styles.catchLight} />
        </Animated.View>
      </Animated.View>
    );
  }

  // ── Mouth ────────────────────────────────────────────────────────────────
  // A real, warm smile is the default. The arc is drawn from a circle with only
  // its bottom border showing (rounded → curved line), so it reads as a grin even
  // at ~40px. Per-state mouths override it where a different shape is more truthful.
  function renderMouth() {
    if (expression === 'speaking') {
      return <Animated.View style={[styles.mouth, styles.mouthSpeaking, { transform: [{ scaleY: mouthSpeakScale }] }]} />;
    }
    if (expression === 'listening') {
      // Small attentive "o".
      return <View style={[styles.mouth, styles.mouthListening]} />;
    }
    if (expression === 'sleeping') {
      // Tiny calm mouth, slightly parted on the breath (the puff bubble does the rest).
      return (
        <Animated.View style={[styles.mouth, styles.mouthSleeping, { transform: [{ scaleX: puffScale.interpolate({ inputRange: [0.45, 1], outputRange: [1, 1.3] }) }] }]} />
      );
    }
    if (expression === 'organizing') {
      return <View style={[styles.mouth, styles.mouthFocused]} />;
    }
    if (expression === 'thinking') {
      return <View style={[styles.mouth, styles.mouthThinking]} />;
    }
    if (expression === 'reading') {
      return <View style={[styles.mouth, styles.mouthReading]} />;
    }
    // calm / peek / saving / music → warm visible smile (widens on celebrate).
    return (
      <Animated.View
        style={[
          styles.smileWrap,
          { transform: [{ translateY: smileLift }, { scale: smilingExpr ? smileScale : 1 }] },
        ]}
      >
        <View style={styles.smileArc} />
      </Animated.View>
    );
  }

  // Floating musical note (built from a stem + note-head) used in the music state.
  function MusicNote({ delay, x, anim }: { delay: number; x: number; anim: Animated.Value }) {
    return (
      <Animated.View
        pointerEvents="none"
        style={[
          styles.note,
          {
            left: 23 + x,
            opacity: anim.interpolate({ inputRange: [0, 0.15, 0.8, 1], outputRange: [0, 0.95, 0.6, 0] }),
            transform: [
              { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [0, -26] }) },
              { translateX: anim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, x > 0 ? 5 : -5, x > 0 ? 2 : -2] }) },
              { rotate: anim.interpolate({ inputRange: [0, 1], outputRange: ['-8deg', '10deg'] }) },
            ],
          },
        ]}
      >
        <View style={styles.noteStem} />
        <View style={styles.noteHead} />
      </Animated.View>
    );
  }

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
          <Animated.View style={[styles.face, { transform: [{ translateY: bobY }, { rotate: bobTilt }] }]}>
            <View style={[styles.eyesRow, { gap: eyeShape.gap }]}>
              {renderEye('left')}
              {renderEye('right')}
            </View>
            {renderMouth()}

            {/* Reading glasses — two soft lenses + a bridge sit over the eyes. */}
            {expression === 'reading' ? (
              <Animated.View pointerEvents="none" style={[styles.glasses, { opacity: propIn, transform: [{ translateY: propDrop }, { scale: propScale }] }]}>
                <View style={styles.lens} />
                <View style={styles.glassBridge} />
                <View style={styles.lens} />
              </Animated.View>
            ) : null}
          </Animated.View>
        </Animated.View>

        {/* Headphones — a top band + two ear cups frame the orb during music. */}
        {expression === 'music' ? (
          <Animated.View pointerEvents="none" style={[styles.headphones, { opacity: propIn, transform: [{ translateY: propDrop }, { scale: propScale }] }]}>
            <View style={styles.hpBand} />
            <View style={[styles.hpCup, styles.hpCupLeft]} />
            <View style={[styles.hpCup, styles.hpCupRight]} />
          </Animated.View>
        ) : null}

        {/* Floating musical notes drift up while listening to music. */}
        {expression === 'music' ? (
          <>
            <MusicNote delay={0} x={-9} anim={note0} />
            <MusicNote delay={0} x={8} anim={note1} />
            <MusicNote delay={0} x={-1} anim={note2} />
          </>
        ) : null}

        {/* Thought bubble — a small trail of dots + a rounded bubble for thinking. */}
        {expression === 'thinking' ? (
          <Animated.View pointerEvents="none" style={[styles.thought, { opacity: propIn, transform: [{ scale: propScale }, { translateY: propDrop }] }]}>
            <View style={styles.thoughtBubble}>
              <Animated.View style={[styles.thoughtDot, { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }]} />
              <Animated.View style={[styles.thoughtDot, { opacity: pulse.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0.3, 1] }) }]} />
              <Animated.View style={[styles.thoughtDot, { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.3] }) }]} />
            </View>
            <View style={styles.thoughtTail2} />
            <View style={styles.thoughtTail1} />
          </Animated.View>
        ) : null}

        {/* Snore puff — a soft bubble that inflates/deflates on the breath cycle. */}
        {mood === 'sleeping' ? (
          <Animated.View pointerEvents="none" style={[styles.snorePuff, { opacity: puffOpacity, transform: [{ scale: puffScale }] }]} />
        ) : null}

        {/* Celebrate sparkles — a quick warm burst around Lucy. */}
        {sparkleNodes}

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
  specular: { position: 'absolute', top: 5, left: 7, width: 9, height: 6, borderRadius: 4.5 },
  face: { alignItems: 'center', justifyContent: 'center', gap: 2.5 },
  eyesRow: { flexDirection: 'row', minHeight: 12, alignItems: 'center' },
  // Open, rounded "white" of the eye — the base that makes Lucy look awake.
  eyeWhite: {
    backgroundColor: EYE_WHITE,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  // Dark iris/pupil that sits inside and tracks gaze.
  iris: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: IRIS,
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
  },
  // Tiny specular highlight on the iris = the "alive" catch-light.
  catchLight: {
    width: 1.8,
    height: 1.8,
    borderRadius: 1,
    backgroundColor: 'rgba(255,255,255,0.95)',
    marginTop: 0.6,
    marginLeft: 0.6,
  },
  // Peaceful closed lid for the only genuinely-asleep state.
  lid: {
    width: 10,
    height: 3,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    borderTopWidth: 2,
    borderColor: LID,
    backgroundColor: 'transparent',
  },
  mouth: {
    width: 12,
    height: 6,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    borderWidth: 2,
    borderTopWidth: 0,
    borderColor: LID,
    marginTop: 1,
  },
  mouthSleeping: { width: 7, height: 2, borderRadius: 1, borderWidth: 0, backgroundColor: LID },
  mouthListening: { width: 7, height: 8, borderRadius: 5, borderWidth: 2, borderColor: LID, marginTop: 1 },
  mouthSpeaking: { width: 12, height: 9, borderBottomLeftRadius: 10, borderBottomRightRadius: 10, borderTopLeftRadius: 4, borderTopRightRadius: 4, borderWidth: 2, borderColor: LID, marginTop: 1 },
  mouthFocused: { width: 11, height: 2, borderRadius: 1, borderWidth: 0, backgroundColor: LID, marginTop: 3 },
  mouthThinking: { width: 8, height: 5, borderLeftWidth: 0, borderRightWidth: 2, borderTopWidth: 0, borderBottomWidth: 2, borderColor: LID, borderRadius: 5, transform: [{ rotate: '-12deg' }] },
  mouthSaving: { width: 13, height: 6, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, borderWidth: 2, borderTopWidth: 0, borderColor: LID, marginTop: 0 },
  mouthReading: { width: 10, height: 2, borderRadius: 1, borderWidth: 0, backgroundColor: LID, opacity: 0.8, marginTop: 3 },

  // Warm visible smile — a wide circle showing only its bottom border = a curved grin.
  smileWrap: { width: 16, height: 9, marginTop: 1.5, alignItems: 'center', justifyContent: 'flex-start', overflow: 'hidden' },
  smileArc: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: LID,
    backgroundColor: 'transparent',
    marginTop: -8,
  },

  // Reading glasses — two lenses + a bridge, drawn over the eyes.
  glasses: { position: 'absolute', top: 0, flexDirection: 'row', alignItems: 'center', gap: 1 },
  lens: { width: 11, height: 11, borderRadius: 5.5, borderWidth: 1.6, borderColor: LID, backgroundColor: 'rgba(255,255,255,0.06)' },
  glassBridge: { width: 4, height: 1.6, backgroundColor: LID, marginTop: -2 },

  // Headphones — band over the top, ear cups on the sides of the orb.
  headphones: { position: 'absolute', width: 46, height: 46, alignItems: 'center' },
  hpBand: { position: 'absolute', top: 1, width: 30, height: 16, borderTopLeftRadius: 16, borderTopRightRadius: 16, borderWidth: 2.4, borderBottomWidth: 0, borderColor: LID },
  hpCup: { position: 'absolute', top: 15, width: 6, height: 11, borderRadius: 3, backgroundColor: LID },
  hpCupLeft: { left: 6 },
  hpCupRight: { right: 6 },

  // Floating music note — stem + filled head.
  note: { position: 'absolute', bottom: 12, width: 8, height: 10, alignItems: 'flex-end' },
  noteStem: { width: 1.6, height: 8, backgroundColor: LUCY_COLORS.primaryGlow, borderRadius: 1 },
  noteHead: { position: 'absolute', bottom: 0, left: 0, width: 4.5, height: 3.5, borderRadius: 2, backgroundColor: LUCY_COLORS.primaryGlow, transform: [{ rotate: '-18deg' }] },

  // Thought bubble — rounded bubble with three dots + a two-dot tail.
  thought: { position: 'absolute', top: -10, right: -10, alignItems: 'center' },
  thoughtBubble: { flexDirection: 'row', gap: 2.5, alignItems: 'center', backgroundColor: LUCY_COLORS.surfaceElevated, borderRadius: 9, paddingHorizontal: 5, paddingVertical: 3.5, borderWidth: 1, borderColor: LUCY_COLORS.primaryLine },
  thoughtDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: LUCY_COLORS.primaryGlow },
  thoughtTail1: { width: 4, height: 4, borderRadius: 2, backgroundColor: LUCY_COLORS.surfaceElevated, borderWidth: 1, borderColor: LUCY_COLORS.primaryLine, marginTop: 1, marginRight: 6 },
  thoughtTail2: { width: 2.5, height: 2.5, borderRadius: 1.5, backgroundColor: LUCY_COLORS.surfaceElevated, borderWidth: 1, borderColor: LUCY_COLORS.primaryLine, marginTop: 1, marginRight: 9 },

  // Snore puff — soft pale bubble at the mouth that breathes.
  snorePuff: { position: 'absolute', bottom: 9, right: 9, width: 9, height: 9, borderRadius: 5, backgroundColor: 'rgba(255,235,200,0.55)', borderWidth: 1, borderColor: 'rgba(255,235,200,0.35)' },

  // Celebrate sparkle — small warm diamond.
  sparkle: { position: 'absolute', width: 5, height: 5, borderRadius: 1, backgroundColor: LUCY_COLORS.gold, transform: [{ rotate: '45deg' }] },
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
