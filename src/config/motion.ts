/**
 * LUCY motion tokens — Pillar P5 "Visual Craft" (v3 redesign).
 *
 * One vocabulary for movement so every surface springs, eases and times the same way. Pure RN
 * `Animated` (no Reanimated / no new deps), native-driver friendly. Additive: the existing
 * `Motion.tsx` (FadeInUp / Stagger / PressableScale) and `haptics.ts` `springs` stay as-is; these
 * tokens are the shared SOURCE that later phases build choreography on top of.
 *
 * Accessibility is first-class: `useReducedMotion()` mirrors the OS "Reduce Motion" switch, and
 * `motionConfig()` downgrades movement to a plain fade (or instant) when it's on.
 *
 *   const reduced = useReducedMotion();
 *   Animated.spring(v, { toValue: 1, ...SPRING.settle }).start();
 *   Animated.timing(o, motionConfig({ toValue: 1, ...TIMING.fade }, reduced)).start();
 */
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Easing } from 'react-native';

// ── Spring presets (tension / friction) ────────────────────────────────────────────────────────
// Tuned to LUCY's established feel: the calm slide-up (tension ~68, friction ~12) is the house spring.
export const SPRING = {
  /** The signature calm settle — large surfaces, sheets, hero entrances. No cartoon overshoot. */
  settle: { tension: 68, friction: 12, useNativeDriver: true },
  /** Quick + decisive — buttons, toggles, small state flips. */
  snap: { tension: 300, friction: 20, useNativeDriver: true },
  /** Smooth disclosure — expanding cards, segmented bar reveal. */
  open: { tension: 200, friction: 22, useNativeDriver: true },
  /** Playful, with a little life — celebrate / first-capture moments. */
  bounce: { tension: 200, friction: 8, useNativeDriver: true },
} as const;

export type SpringKey = keyof typeof SPRING;

// ── Duration tokens (ms) ────────────────────────────────────────────────────────────────────────
export const DURATION = {
  instant: 0,
  micro: 120,  // a press tint, a tiny tick
  fast: 180,   // chip / pill state
  base: 220,   // standard fade / cross-fade
  slow: 320,   // sheet content, count-up
  lazy: 600,   // ambient / count-up of large numbers
} as const;

export type DurationKey = keyof typeof DURATION;

// ── Easing tokens ─────────────────────────────────────────────────────────────────────────────
// Named curves so timings read consistently. `standard` is the everyday in/out; `decelerate` for
// things entering (fast → rest); `accelerate` for things leaving.
export const EASING = {
  standard: Easing.bezier(0.4, 0, 0.2, 1),
  decelerate: Easing.out(Easing.cubic),
  accelerate: Easing.in(Easing.cubic),
  emphasized: Easing.bezier(0.2, 0, 0, 1),
  linear: Easing.linear,
} as const;

export type EasingKey = keyof typeof EASING;

// ── Reduce-motion ────────────────────────────────────────────────────────────────────────────
// Read once, then stay live (so toggling Settings updates new mounts immediately). Mirrors the
// pattern already used inside Motion.tsx, exported here as the shared token-layer hook.
let reduceMotionCache = false;
void AccessibilityInfo.isReduceMotionEnabled()
  .then((on) => { reduceMotionCache = on; })
  .catch(() => {});

/** The current cached reduce-motion value (sync; for one-off non-reactive reads). */
export function reduceMotionEnabled(): boolean {
  return reduceMotionCache;
}

/** Live, reactive reduce-motion flag. Use to branch animation vs. instant/fade. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(reduceMotionCache);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => { if (alive) { reduceMotionCache = on; setReduced(on); } })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (on) => {
      reduceMotionCache = on;
      setReduced(on);
    });
    return () => { alive = false; sub.remove(); };
  }, []);
  return reduced;
}

type TimingConfig = Omit<Animated.TimingAnimationConfig, 'useNativeDriver'> & { useNativeDriver?: boolean };

/**
 * Reduce-motion-aware timing config. When reduce-motion is ON, collapses any movement to a near-instant
 * fade (duration → instant) so content still appears but nothing slides/scales. When OFF, returns the
 * config unchanged (defaulting to the native driver + standard easing).
 *
 *   Animated.timing(opacity, motionConfig({ toValue: 1, duration: DURATION.base }, reduced)).start();
 */
export function motionConfig(config: TimingConfig, reduced: boolean): Animated.TimingAnimationConfig {
  return {
    easing: EASING.standard,
    useNativeDriver: true,
    ...config,
    duration: reduced ? DURATION.instant : (config.duration ?? DURATION.base),
  };
}

/**
 * Reduce-motion-aware spring config. When reduce-motion is ON we hand back a timing-style fade instead
 * (callers can pass the result to Animated.timing); when OFF, the spring preset is returned. To keep a
 * single call-site simple, prefer `motionConfig` for fades and gate springs with the hook:
 *
 *   reduced
 *     ? Animated.timing(v, motionConfig({ toValue: 1 }, true))
 *     : Animated.spring(v, { toValue: 1, ...SPRING.settle })
 *
 * This helper just resolves the spring preset (or `settle`) for the non-reduced path.
 */
export function springConfig(key: SpringKey = 'settle'): typeof SPRING[SpringKey] {
  return SPRING[key];
}
