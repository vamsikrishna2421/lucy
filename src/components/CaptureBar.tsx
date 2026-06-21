/**
 * CaptureBar — LUCY's persistent, thumb-zone CAPTURE entry (Phase 2 of the v3 redesign, Pillar P4).
 *
 * Capture is THE primary action, so it lives ALWAYS-ON, pinned just above the bottom nav row where the
 * thumb naturally rests. It is deliberately slim in its resting state (a single tappable field-pill) and
 * expands into a full composer when focused — progressive disclosure for the action, never hidden behind
 * a tab. Wired to the SAME capture path as the Tasks screen (`enqueueTranscript`), so it does NOT
 * reinvent extraction; it simply enqueues + lets the app's existing drain/extract pipeline run.
 *
 * Stacking (resolved with the existing chrome):
 *   header → screen content → **CaptureBar** → bottomNav (center mic protrudes up) → safe-area inset.
 * The bar owns the strip directly above the nav; the center voice button still floats above the nav row,
 * and the camera FAB is lifted clear of the bar (see App.tsx cameraFab bottom offset). Nothing sits under
 * the home indicator — the parent SafeAreaView + the nav's own bottom padding cover the inset.
 *
 * Behavior preserved: this is additive shell wiring. Voice capture stays on the center nav mic; the
 * camera FAB stays where it is. This bar is the calm text/▢ "jot it down" lane.
 *
 * a11y / P4: ≥48dp targets + hitSlop, reduce-motion aware (expand collapses to a fade), safe to use on
 * 360dp width. Haptic on a successful capture (the app's signature success buzz).
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { LUCY_COLORS, LUCY_SHADOWS } from '../config/colors';
import { DURATION, motionConfig, useReducedMotion } from '../config/motion';
import { haptic } from '../config/haptics';
import { typeStyle } from '../config/type';

export function CaptureBar({
  /** Enqueue the typed thought through LUCY's existing capture path. Returns when queued. */
  onCapture,
  /** Optional: jump to the camera picker (mirrors the global Snap-it entry). */
  onSnap,
  /** Placeholder copy for the resting pill + expanded composer. */
  placeholder = 'Capture a thought…',
}: {
  onCapture: (text: string) => Promise<void> | void;
  onSnap?: () => void;
  placeholder?: string;
}) {
  const reduced = useReducedMotion();
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const [sending, setSending] = useState(false);
  const [ack, setAck] = useState('');
  const inputRef = useRef<TextInput>(null);

  // Expand animation: the resting pill grows into the composer (height + a touch of lift). Reduce-motion
  // collapses this to an instant value change (still functional, no movement).
  const expand = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(expand, motionConfig({ toValue: focused ? 1 : 0, duration: DURATION.fast, useNativeDriver: false }, reduced)).start();
  }, [focused, reduced, expand]);

  const hasText = text.trim().length > 0;

  const send = async () => {
    const out = text.trim();
    if (!out || sending) return;
    setSending(true);
    try {
      await onCapture(out);
      haptic.capture(); // the app's signature success buzz
      setText('');
      setAck('Got it ✓');
      setTimeout(() => setAck(''), 1600);
      Keyboard.dismiss();
      setFocused(false);
    } catch {
      // No scary states — keep the text so nothing is lost; the user can retry.
    } finally {
      setSending(false);
    }
  };

  // Resting (collapsed) state: a single thumb-reachable pill that focuses the composer on tap.
  if (!focused) {
    return (
      <View style={styles.wrap}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Capture a thought"
          hitSlop={6}
          style={({ pressed }) => [styles.restPill, pressed && styles.restPillPressed]}
          onPress={() => { setFocused(true); requestAnimationFrame(() => inputRef.current?.focus()); }}
        >
          <View style={styles.restIcon}>
            <Ionicons name="add" size={18} color={LUCY_COLORS.white} />
          </View>
          <Text style={[typeStyle('ui.body'), styles.restPlaceholder]} numberOfLines={1}>
            {ack || placeholder}
          </Text>
          {onSnap ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Snap a photo"
              hitSlop={10}
              style={({ pressed }) => [styles.restSnap, pressed && { opacity: 0.6 }]}
              onPress={onSnap}
            >
              <Ionicons name="camera-outline" size={20} color={LUCY_COLORS.textMuted} />
            </Pressable>
          ) : null}
        </Pressable>
      </View>
    );
  }

  // Expanded composer state.
  return (
    <View style={styles.wrap}>
      <Animated.View
        style={[
          styles.composer,
          {
            transform: [{ translateY: expand.interpolate({ inputRange: [0, 1], outputRange: [4, 0] }) }],
          },
        ]}
      >
        <TextInput
          ref={inputRef}
          multiline
          value={text}
          onChangeText={setText}
          placeholder={placeholder}
          placeholderTextColor={LUCY_COLORS.textFaint}
          style={[typeStyle('ui.body'), styles.input]}
          textAlignVertical="top"
          returnKeyType={Platform.OS === 'ios' ? 'default' : 'send'}
          blurOnSubmit={false}
          onBlur={() => { if (!hasText) setFocused(false); }}
          autoFocus
        />
        <View style={styles.composerActions}>
          {onSnap ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Snap a photo"
              hitSlop={8}
              style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}
              onPress={onSnap}
            >
              <Ionicons name="camera-outline" size={22} color={LUCY_COLORS.textMuted} />
            </Pressable>
          ) : null}
          <View style={{ flex: 1 }} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
            hitSlop={8}
            style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}
            onPress={() => { Keyboard.dismiss(); setFocused(false); }}
          >
            <Ionicons name="chevron-down" size={22} color={LUCY_COLORS.textSubtle} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Capture"
            accessibilityState={{ disabled: !hasText || sending }}
            disabled={!hasText || sending}
            style={({ pressed }) => [
              styles.sendBtn,
              (!hasText || sending) && styles.sendBtnDisabled,
              pressed && hasText && !sending && { backgroundColor: LUCY_COLORS.primaryDeep },
            ]}
            onPress={() => void send()}
          >
            {sending ? (
              <Ionicons name="ellipsis-horizontal" size={18} color={LUCY_COLORS.white} />
            ) : (
              <Ionicons name="arrow-up" size={20} color={LUCY_COLORS.white} />
            )}
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // The strip directly above the bottom nav. Hairline top edge ties it to the nav as one bottom cluster.
  wrap: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 6,
    backgroundColor: LUCY_COLORS.surfaceSheet,
    borderTopWidth: 1,
    borderTopColor: LUCY_COLORS.borderSoft,
  },

  // Resting pill — slim, one-tap, thumb-reachable.
  restPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
    paddingLeft: 6,
    paddingRight: 8,
    borderRadius: 26,
    backgroundColor: LUCY_COLORS.surfaceRaised,
    borderWidth: 1,
    borderColor: LUCY_COLORS.border,
    ...LUCY_SHADOWS.sm,
  },
  restPillPressed: { backgroundColor: LUCY_COLORS.primaryMist, borderColor: LUCY_COLORS.primaryLine },
  restIcon: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: LUCY_COLORS.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  restPlaceholder: { flex: 1, color: LUCY_COLORS.textMuted },
  restSnap: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },

  // Expanded composer.
  composer: {
    backgroundColor: LUCY_COLORS.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: LUCY_COLORS.primaryLine,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 8,
    ...LUCY_SHADOWS.md,
  },
  input: { maxHeight: 120, minHeight: 24, color: LUCY_COLORS.textDark, paddingVertical: 0 },
  composerActions: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: LUCY_COLORS.primary,
    alignItems: 'center', justifyContent: 'center',
    marginLeft: 4,
  },
  sendBtnDisabled: { backgroundColor: LUCY_COLORS.textFaint, opacity: 0.6 },
});
