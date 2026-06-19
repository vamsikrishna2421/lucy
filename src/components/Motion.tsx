/**
 * Motion — tiny, dependency-free entrance/press primitives so the app feels smooth and alive
 * without any new libraries. Pure RN `Animated` on the native driver (transform + opacity only),
 * so it stays cheap and never touches layout on the JS thread.
 *
 * The physics match LUCY's established premium feel:
 *   - entrance spring borrows the calm settle used by ConversationModal's slide-up
 *     (tension ~68, friction ~12) and the Ask insight cards (friction 8 / tension 60) — a gentle
 *     rise with no cartoon overshoot, which keeps large surfaces calm.
 *   - press feedback reuses CategoryCard's exact scale spring (0.97, snappy in / soft out).
 *
 * Accessibility: every component honours the OS "Reduce Motion" setting. When it's on, content
 * appears instantly at its final state and the press-scale is skipped — same layout, no movement.
 *
 * Usage:
 *   <FadeInUp delay={80}><Card /></FadeInUp>
 *   <Stagger>{items.map(it => <FadeInUp key={it.id}><Row item={it} /></FadeInUp>)}</Stagger>
 *   <PressableScale onPress={open}><Card /></PressableScale>
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Pressable,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

// ── Reduce-motion: read once, then keep live. Components fall back to the static final state. ──
let reduceMotionCache = false;
void AccessibilityInfo.isReduceMotionEnabled()
  .then((on) => { reduceMotionCache = on; })
  .catch(() => {});

/** Subscribe to reduce-motion changes so toggling it in Settings updates new mounts immediately. */
function useReduceMotion(): boolean {
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

// Calm entrance spring — settles quickly, no bouncy overshoot (safe for big cards).
const ENTER_SPRING = { tension: 70, friction: 13, useNativeDriver: true } as const;
// How far a FadeInUp child rises into place. Kept small per the design system ("slight" translate).
const RISE = 12;

interface FadeInUpProps {
  children: React.ReactNode;
  /** Delay before the entrance starts, in ms (Stagger sets this automatically). */
  delay?: number;
  /** Rise distance override (px). Defaults to 12 — keep small on large surfaces. */
  distance?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Fade + slight upward translate on mount. Animates ONCE when it mounts — when new items are
 * added to a list, only the freshly-mounted instances animate; existing ones stay put (no
 * re-stagger on every refresh). Drives a single value (0→1) for opacity + translateY together.
 */
export function FadeInUp({ children, delay = 0, distance = RISE, style }: FadeInUpProps): React.ReactElement {
  const reduced = useReduceMotion();
  const t = useRef(new Animated.Value(reduced ? 1 : 0)).current;

  useEffect(() => {
    if (reduced) { t.setValue(1); return; }
    t.setValue(0);
    const anim = Animated.spring(t, { ...ENTER_SPRING, toValue: 1, delay });
    anim.start();
    return () => anim.stop();
    // delay is captured per-mount; re-running on delay change would replay the entrance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: t,
          transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

interface StaggerProps {
  children: React.ReactNode;
  /** Per-item delay step, in ms. */
  step?: number;
  /** Delay before the whole group begins, in ms. */
  initialDelay?: number;
  /**
   * Cap on how many items get an increasing delay. Beyond this they all share the max delay so a
   * long list never ends with a sluggish tail. Defaults to 8 (~440ms of cascade at step 55).
   */
  maxStagger?: number;
}

/**
 * Wraps a list and gives each child an increasing entrance `delay` so items cascade in gently.
 * It clones direct children that accept a `delay` prop (e.g. FadeInUp), injecting the computed
 * delay — children already carrying a `delay` are left untouched. Non-element children (null,
 * strings) pass straight through. The cascade is delay-only; it never re-runs on scroll.
 */
export function Stagger({
  children,
  step = 55,
  initialDelay = 0,
  maxStagger = 8,
}: StaggerProps): React.ReactElement {
  let i = 0;
  const mapped = React.Children.map(children, (child) => {
    if (!React.isValidElement(child)) return child;
    const existing = (child.props as { delay?: number }).delay;
    if (typeof existing === 'number') return child; // respect an explicit delay
    const delay = initialDelay + Math.min(i, maxStagger) * step;
    i += 1;
    return React.cloneElement(child as React.ReactElement<{ delay?: number }>, { delay });
  });
  return <>{mapped}</>;
}

interface ScreenFadeProps {
  /** Whether this screen is the one currently shown. */
  active: boolean;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * A quick cross-fade + slight rise for the bottom-nav screens. Crucially it does NOT mount/unmount
 * its child — the screens stay alive (so their state survives tab switches). It just toggles
 * `display` (off when inactive, like before) and runs a ~200ms fade/rise WHEN the screen becomes
 * active. It never intercepts touches: when active it ends fully opaque at translateY 0, and the
 * brief entrance uses the native driver so taps register immediately.
 */
export function ScreenFade({ active, children, style }: ScreenFadeProps): React.ReactElement {
  const reduced = useReduceMotion();
  const t = useRef(new Animated.Value(active ? 1 : 0)).current;
  const wasActive = useRef(active);

  useEffect(() => {
    // Only animate the transition INTO view; leaving is instant (the incoming screen carries the motion).
    if (active && !wasActive.current) {
      if (reduced) {
        t.setValue(1);
      } else {
        t.setValue(0);
        Animated.timing(t, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      }
    } else if (active) {
      t.setValue(1);
    }
    wasActive.current = active;
  }, [active, reduced, t]);

  return (
    <Animated.View
      style={[
        style,
        { display: active ? 'flex' : 'none' },
        active && !reduced
          ? {
              opacity: t,
              transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
            }
          : null,
      ]}
    >
      {children}
    </Animated.View>
  );
}

interface PressableScaleProps {
  children: React.ReactNode;
  onPress?: (e: GestureResponderEvent) => void;
  onLongPress?: (e: GestureResponderEvent) => void;
  disabled?: boolean;
  /** Resting → pressed scale. Default 0.97 (matches the task cards). */
  scaleTo?: number;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  hitSlop?: number | { top?: number; bottom?: number; left?: number; right?: number };
}

/**
 * A tap target that springs to ~0.97 on press and settles back on release — the same gentle
 * tactile feedback the Tasks category cards use, made reusable. Built on RN's `Pressable`, so it
 * composes correctly with scrolling and nested touchables (it cancels the scale if the press is
 * interrupted by a scroll). Falls back to a plain pressable (no scale) when Reduce Motion is on.
 */
export function PressableScale({
  children,
  onPress,
  onLongPress,
  disabled,
  scaleTo = 0.97,
  style,
  accessibilityLabel,
  hitSlop,
}: PressableScaleProps): React.ReactElement {
  const reduced = useReduceMotion();
  const scale = useRef(new Animated.Value(1)).current;

  const pressIn = () => {
    if (reduced || disabled) return;
    Animated.spring(scale, { toValue: scaleTo, friction: 30, tension: 400, useNativeDriver: true }).start();
  };
  const pressOut = () => {
    if (reduced || disabled) return;
    Animated.spring(scale, { toValue: 1, friction: 18, tension: 200, useNativeDriver: true }).start();
  };

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={pressIn}
      onPressOut={pressOut}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel}
      hitSlop={hitSlop}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}
