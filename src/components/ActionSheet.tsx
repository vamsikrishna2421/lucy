/**
 * ActionSheet + Toast — designed replacements for plain `Alert.alert`, following the LUCY card/sheet
 * anatomy (docs/LUCY_DESIGN_SYSTEM.md): grip → context line → bold title → message → stacked actions
 * (one filled primary; destructive = error-tinted; cancel = plain). RN Modal + Animated only — no
 * native deps, OTA-safe.
 *
 * Two pieces:
 *   - <ActionSheet> — controlled bottom sheet for confirms / choices / informational popups.
 *   - <Toast> — a lightweight, self-dismissing pill for transient successes ("Logged ✓").
 *
 * Both are additive: callers keep their existing handlers; this only changes look & feel.
 */
import { useEffect, useRef } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LUCY_COLORS } from '../config/colors';

export type SheetAction = {
  label: string;
  onPress?: () => void;
  /** 'primary' = filled amber, 'destructive' = error-tinted outline, 'default' = outline. */
  style?: 'primary' | 'destructive' | 'default';
};

export function ActionSheet({
  visible,
  onClose,
  context,
  title,
  message,
  accent = LUCY_COLORS.primary,
  actions,
  cancelLabel = 'Cancel',
}: {
  visible: boolean;
  onClose: () => void;
  /** Small muted line above the title (when / where / source). Optional. */
  context?: string;
  title: string;
  message?: string;
  /** Accent bar color tied to the item/category. */
  accent?: string;
  actions: SheetAction[];
  /** Pass null to hide the cancel row. */
  cancelLabel?: string | null;
}) {
  const slide = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(slide, { toValue: 1, tension: 68, friction: 12, useNativeDriver: true }),
        Animated.timing(fade, { toValue: 1, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]).start();
    } else {
      slide.setValue(0);
      fade.setValue(0);
    }
  }, [visible, slide, fade]);

  const translateY = slide.interpolate({ inputRange: [0, 1], outputRange: [320, 0] });

  const run = (a: SheetAction) => {
    onClose();
    // Let the sheet begin dismissing before the handler fires anything heavy.
    requestAnimationFrame(() => a.onPress?.());
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={[styles.backdrop, { opacity: fade }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>
      <View style={styles.anchor} pointerEvents="box-none">
        <Animated.View style={[styles.card, { transform: [{ translateY }] }]}>
          <View style={styles.grip} />
          <View style={[styles.accentBar, { backgroundColor: accent }]} />
          {context ? <Text style={styles.context}>{context}</Text> : null}
          <Text style={styles.title}>{title}</Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}
          <View style={styles.actions}>
            {actions.map((a, i) => {
              const isPrimary = a.style === 'primary';
              const isDestructive = a.style === 'destructive';
              return (
                <TouchableOpacity
                  key={`${a.label}-${i}`}
                  activeOpacity={0.85}
                  style={[
                    styles.actionBtn,
                    isPrimary && styles.actionPrimary,
                    isDestructive && styles.actionDestructive,
                    !isPrimary && !isDestructive && styles.actionDefault,
                  ]}
                  onPress={() => run(a)}
                >
                  <Text
                    style={[
                      styles.actionText,
                      isPrimary && styles.actionTextPrimary,
                      isDestructive && styles.actionTextDestructive,
                    ]}
                  >
                    {a.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
            {cancelLabel ? (
              <TouchableOpacity activeOpacity={0.7} style={styles.cancelBtn} onPress={onClose}>
                <Text style={styles.cancelText}>{cancelLabel}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

/**
 * Toast — a transient success pill that slides down from the top and fades out on its own.
 * Use for "Logged ✓"-style moments where a full sheet is overkill.
 */
export function Toast({
  visible,
  message,
  onHide,
  icon = '✓',
  duration = 2200,
}: {
  visible: boolean;
  message: string;
  onHide: () => void;
  icon?: string;
  duration?: number;
}) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    anim.setValue(0);
    Animated.sequence([
      Animated.spring(anim, { toValue: 1, tension: 68, friction: 12, useNativeDriver: true }),
      Animated.delay(duration),
      Animated.timing(anim, { toValue: 0, duration: 220, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]).start(({ finished }) => { if (finished) onHide(); });
  }, [visible, anim, duration, onHide]);

  if (!visible) return null;

  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [-60, 0] });

  // Render in a non-blocking transparent Modal so the toast floats above the screen regardless of
  // where it's mounted (e.g. inside a ScrollView) and never intercepts touches.
  return (
    <Modal visible transparent animationType="none" statusBarTranslucent>
      <View style={styles.toastAnchor} pointerEvents="none">
        <Animated.View style={[styles.toast, { opacity: anim, transform: [{ translateY }] }]}>
          <View style={styles.toastIconWrap}><Text style={styles.toastIcon}>{icon}</Text></View>
          <Text style={styles.toastText} numberOfLines={2}>{message}</Text>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)' },
  anchor: { flex: 1, justifyContent: 'flex-end' },
  card: {
    backgroundColor: LUCY_COLORS.surfaceSheet,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderWidth: 1,
    borderColor: LUCY_COLORS.border,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 30,
    shadowColor: LUCY_COLORS.primary,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 18,
    elevation: 12,
  },
  grip: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: LUCY_COLORS.border, marginBottom: 14 },
  accentBar: { width: 36, height: 3, borderRadius: 2, marginBottom: 10 },
  context: { color: LUCY_COLORS.primaryGlow, fontSize: 11, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 4 },
  title: { color: LUCY_COLORS.textDark, fontSize: 21, fontWeight: '900', letterSpacing: -0.2 },
  message: { color: LUCY_COLORS.textMuted, fontSize: 13.5, lineHeight: 20, marginTop: 8 },
  actions: { marginTop: 20, gap: 9 },
  actionBtn: { borderRadius: 14, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  actionPrimary: {
    backgroundColor: LUCY_COLORS.primary,
    borderColor: LUCY_COLORS.primary,
    shadowColor: LUCY_COLORS.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  actionDestructive: { backgroundColor: 'transparent', borderColor: 'rgba(251,113,133,0.45)' },
  actionDefault: { backgroundColor: LUCY_COLORS.surfaceRaised, borderColor: LUCY_COLORS.border },
  actionText: { fontSize: 15, fontWeight: '800', color: LUCY_COLORS.textDark },
  actionTextPrimary: { color: '#1A1206' },
  actionTextDestructive: { color: LUCY_COLORS.error },
  cancelBtn: { paddingVertical: 13, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  cancelText: { fontSize: 14.5, fontWeight: '700', color: LUCY_COLORS.textSubtle },

  // Toast
  toastAnchor: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', paddingTop: 60 },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    maxWidth: '88%',
    backgroundColor: LUCY_COLORS.surfaceElevated,
    borderWidth: 1,
    borderColor: LUCY_COLORS.primaryLine,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 10,
  },
  toastIconWrap: {
    width: 22, height: 22, borderRadius: 11, backgroundColor: LUCY_COLORS.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  toastIcon: { color: '#1A1206', fontSize: 13, fontWeight: '900' },
  toastText: { color: LUCY_COLORS.textDark, fontSize: 13.5, fontWeight: '700', flexShrink: 1 },
});
