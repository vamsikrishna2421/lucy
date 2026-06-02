/**
 * LUCY haptic choreography — haptics are punctuation, not decoration.
 * Each moment is chosen for emotional resonance, not just feedback.
 */
import * as Haptics from 'expo-haptics';

export const haptic = {
  /** Thought captured — a moment of completion, light and satisfying */
  capture: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}),

  /** Task checked off — medium impact, decisive, earned */
  taskDone: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}),

  /** Task undone — soft light tap, reversing direction */
  taskUndo: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}),

  /** Timeline card expanded — subtle light tap as content reveals */
  expand: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}),

  /** Delete / destructive action confirmed — warning weight */
  destructive: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {}),

  /** Error state hit (network fail, key missing) — error notification */
  error: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {}),

  /** Listen mode started — signal that microphone is now active */
  listenStart: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}),

  /** Tab switch — micro tap, just enough to feel real */
  tab: () => Haptics.selectionAsync().catch(() => {}),

  /** Long press detected — brief medium to confirm hold registered */
  longPress: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}),
};

/** Spring animation config — the physics that make LUCY feel premium.
 *  Low friction + high tension = snappy without bouncing. */
export const springs = {
  /** Quick, decisive — buttons, toggles, small state changes */
  snap: { friction: 20, tension: 300, useNativeDriver: true },
  /** Smooth card expansion — modal sheets, expanding content */
  open: { friction: 22, tension: 200, useNativeDriver: true },
  /** Gentle page-level transitions */
  ease: { friction: 26, tension: 150, useNativeDriver: true },
  /** Playful bounce — celebratory moments (task streak, first capture) */
  bounce: { friction: 8, tension: 200, useNativeDriver: true },
} as const;
