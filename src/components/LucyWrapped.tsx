/**
 * LUCY Wrapped — animated sequential reveal of quarterly stats.
 * Tap anywhere to advance. Share button on the last slide.
 */

import { useEffect, useRef, useState } from 'react';
import {
  Animated, Easing, Modal, Platform, Pressable, Share,
  StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { LUCY_COLORS } from '../config/colors';
import { getDatabase } from '../db';
import { haptic } from '../config/haptics';
import { generateWrapped, markWrappedShown, type WrappedSlide } from '../processing/lucyWrapped';

function SlideView({ slide, index, total }: { slide: WrappedSlide; index: number; total: number }) {
  const scale = useRef(new Animated.Value(0.88)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, friction: 14, tension: 200, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 280, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start();
    return () => { scale.setValue(0.88); opacity.setValue(0); };
  }, [slide.id]);

  return (
    <Animated.View style={[styles.slide, { transform: [{ scale }], opacity }]}>
      {/* Progress dots */}
      <View style={styles.dots}>
        {Array.from({ length: total }).map((_, i) => (
          <View key={i} style={[styles.dot, i === index && styles.dotActive, i < index && styles.dotDone, { backgroundColor: i <= index ? slide.accent : LUCY_COLORS.border }]} />
        ))}
      </View>

      {/* Content */}
      <View style={styles.content}>
        <Text style={styles.emoji}>{slide.emoji}</Text>
        <Text style={[styles.headline, { color: slide.accent }]} adjustsFontSizeToFit numberOfLines={2}>
          {slide.headline}
        </Text>
        <Text style={styles.sub}>{slide.sub}</Text>
        {slide.detail ? <Text style={styles.detail}>{slide.detail}</Text> : null}
      </View>

      {/* Tap hint */}
      <Text style={styles.tapHint}>
        {index < total - 1 ? 'tap to continue →' : 'your story'}
      </Text>
    </Animated.View>
  );
}

export function LucyWrapped({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [slides, setSlides] = useState<WrappedSlide[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!visible) { setIndex(0); return; }
    void (async () => {
      setLoading(true);
      const db = await getDatabase();
      const s = await generateWrapped(db);
      setSlides(s);
      setLoading(false);
    })();
  }, [visible]);

  const advance = () => {
    haptic.tab();
    if (index < slides.length - 1) {
      setIndex((i) => i + 1);
    } else {
      void getDatabase().then((db) => markWrappedShown(db)).catch(() => {});
      onClose();
    }
  };

  const share = async () => {
    try {
      const lines = slides.filter((s) => s.id !== 'close').map(
        (s) => `${s.emoji} ${s.headline} ${s.sub}`
      );
      const text = `My LUCY Wrapped:\n\n${lines.join('\n')}\n\nMy second brain is growing 🧠`;
      // React Native's Share handles plain text directly on iOS + Android — no
      // temp file, no expo-sharing availability check that can silently no-op.
      await Share.share({ message: text });
    } catch { /* user cancelled or non-critical */ }
  };

  const current = slides[index];
  const isLast = index === slides.length - 1;

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <Pressable style={[styles.backdrop, current ? { backgroundColor: `${current.accent}18` } : {}]} onPress={advance}>
        {loading ? (
          <View style={styles.loading}>
            <Text style={{ color: LUCY_COLORS.primary, fontSize: 16, fontWeight: '700' }}>Building your Wrapped…</Text>
          </View>
        ) : current ? (
          <>
            <SlideView slide={current} index={index} total={slides.length} />
            {isLast ? (
              <View style={styles.shareRow}>
                <TouchableOpacity style={[styles.shareBtn, { backgroundColor: current.accent }]} onPress={() => void share()}>
                  <Text style={styles.shareBtnText}>Share ↗</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.closeBtn} onPress={() => { void getDatabase().then((db) => markWrappedShown(db)); onClose(); }}>
                  <Text style={styles.closeBtnText}>Done</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </>
        ) : null}
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#0C0B0980', justifyContent: 'center', alignItems: 'center', padding: 24 },
  loading: { alignItems: 'center' },
  slide: {
    backgroundColor: LUCY_COLORS.surface, borderRadius: 28, padding: 32,
    width: '100%', maxWidth: 360, gap: 0,
    borderWidth: 1, borderColor: LUCY_COLORS.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.45, shadowRadius: 24, elevation: 16,
  },
  dots: { flexDirection: 'row', gap: 5, marginBottom: 32 },
  dot: { height: 3, flex: 1, borderRadius: 2, opacity: 0.3 },
  dotActive: { opacity: 1 },
  dotDone: { opacity: 0.5 },
  content: { alignItems: 'center', gap: 14, paddingVertical: 16 },
  emoji: { fontSize: 52 },
  headline: { fontSize: 56, fontWeight: '900', letterSpacing: -2.5, textAlign: 'center', lineHeight: 60 },
  sub: { color: LUCY_COLORS.textDark, fontSize: 22, fontWeight: '700', textAlign: 'center', lineHeight: 30, letterSpacing: -0.3 },
  detail: { color: LUCY_COLORS.textSubtle, fontSize: 14, textAlign: 'center', lineHeight: 20, marginTop: 4 },
  tapHint: { color: LUCY_COLORS.textSubtle, fontSize: 12, textAlign: 'center', marginTop: 28, fontWeight: '600' },
  shareRow: { flexDirection: 'row', gap: 12, marginTop: 16, width: '100%', maxWidth: 360 },
  shareBtn: { flex: 2, borderRadius: 16, paddingVertical: 14, alignItems: 'center' },
  shareBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  closeBtn: { flex: 1, borderRadius: 16, paddingVertical: 14, alignItems: 'center', backgroundColor: LUCY_COLORS.surfaceRaised, borderWidth: 1, borderColor: LUCY_COLORS.border },
  closeBtnText: { color: LUCY_COLORS.textMuted, fontSize: 15, fontWeight: '700' },
});
