/**
 * LUCY Wrapped — animated sequential reveal of quarterly stats.
 * Tap anywhere to advance. Share button on the last slide.
 */

import { forwardRef, useEffect, useRef, useState } from 'react';
import {
  Alert, Animated, Easing, Modal, Platform, Pressable, Share,
  StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { captureRef } from 'react-native-view-shot';
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
  const [sharing, setSharing] = useState(false);
  const shareCardRef = useRef<View>(null);

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

  // Share the whole Wrapped as ONE beautiful poster image: all the stat cards are
  // composited into a single tall card (rendered off-screen) and captured as a PNG.
  const share = async () => {
    if (slides.length === 0) return;
    setSharing(true);
    try {
      await new Promise((r) => setTimeout(r, 60)); // let the off-screen card lay out
      let uri: string;
      try {
        uri = await captureRef(shareCardRef, { format: 'png', quality: 1, result: 'tmpfile' });
      } catch {
        await new Promise((r) => setTimeout(r, 250));
        uri = await captureRef(shareCardRef, { format: 'png', quality: 0.9, result: 'tmpfile' });
      }
      const Sharing = await import('expo-sharing');
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Share your LUCY Wrapped' });
      } else {
        // Fallback: share text if image sharing isn't available on this device.
        const lines = slides.filter((s) => s.id !== 'close').map((s) => `${s.emoji} ${s.headline} ${s.sub}`);
        await Share.share({ message: `My LUCY Wrapped:\n\n${lines.join('\n')}\n\nMy second brain is growing 🧠` });
      }
    } catch (e) {
      Alert.alert('Could not create image', e instanceof Error ? e.message : String(e));
    } finally {
      setSharing(false);
    }
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
                <TouchableOpacity style={[styles.shareBtn, { backgroundColor: current.accent }, sharing && { opacity: 0.6 }]} onPress={() => void share()} disabled={sharing}>
                  <Text style={styles.shareBtnText}>{sharing ? 'Preparing…' : 'Share ↗'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.closeBtn} onPress={() => { void getDatabase().then((db) => markWrappedShown(db)); onClose(); }}>
                  <Text style={styles.closeBtnText}>Done</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </>
        ) : null}

        {/* Off-screen composite poster — captured as one image when sharing.
            Positioned far left so it's laid out but never visible. */}
        {slides.length > 0 ? (
          <View style={styles.offscreen} pointerEvents="none">
            <WrappedShareCard ref={shareCardRef} slides={slides} />
          </View>
        ) : null}
      </Pressable>
    </Modal>
  );
}

// ─── Composite share poster ─────────────────────────────────────────────────────
// All the stat slides stacked into ONE tall, branded card → a single shareable image.
const WrappedShareCard = forwardRef<View, { slides: WrappedSlide[] }>(({ slides }, ref) => {
  const stats = slides.filter((s) => s.id !== 'close');
  const period = new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  return (
    <View ref={ref} collapsable={false} style={styles.poster}>
      <View style={styles.posterHeader}>
        <Text style={styles.posterBrand}>LUCY <Text style={{ color: LUCY_COLORS.primary }}>✦</Text></Text>
        <Text style={styles.posterTitle}>My Wrapped</Text>
        <Text style={styles.posterPeriod}>{period}</Text>
      </View>
      <View style={styles.posterStats}>
        {stats.map((s, i) => (
          <View key={s.id} style={[styles.posterStat, i === stats.length - 1 && { borderBottomWidth: 0 }]}>
            <Text style={styles.posterStatEmoji}>{s.emoji}</Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.posterStatHeadline, { color: s.accent }]} numberOfLines={1} adjustsFontSizeToFit>{s.headline}</Text>
              <Text style={styles.posterStatSub} numberOfLines={2}>{s.sub}</Text>
            </View>
          </View>
        ))}
      </View>
      <Text style={styles.posterFooter}>my second brain is growing 🧠</Text>
    </View>
  );
});
WrappedShareCard.displayName = 'WrappedShareCard';

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
  // Off-screen container for the capture-only poster.
  offscreen: { position: 'absolute', left: -2000, top: 0 },
  // Composite share poster (one image for all stats).
  poster: { width: 360, backgroundColor: LUCY_COLORS.surface, borderRadius: 28, paddingVertical: 28, paddingHorizontal: 26, borderWidth: 1, borderColor: LUCY_COLORS.border },
  posterHeader: { alignItems: 'center', gap: 2, marginBottom: 18 },
  posterBrand: { color: LUCY_COLORS.textDark, fontSize: 22, fontWeight: '900', letterSpacing: 1 },
  posterTitle: { color: LUCY_COLORS.textDark, fontSize: 34, fontWeight: '900', letterSpacing: -1, marginTop: 2 },
  posterPeriod: { color: LUCY_COLORS.textSubtle, fontSize: 13, fontWeight: '700', marginTop: 2 },
  posterStats: { gap: 0 },
  posterStat: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: LUCY_COLORS.border },
  posterStatEmoji: { fontSize: 30, width: 38, textAlign: 'center' },
  posterStatHeadline: { fontSize: 24, fontWeight: '900', letterSpacing: -0.5 },
  posterStatSub: { color: LUCY_COLORS.textMuted, fontSize: 13, fontWeight: '600', lineHeight: 18, marginTop: 1 },
  posterFooter: { color: LUCY_COLORS.textSubtle, fontSize: 13, fontWeight: '700', textAlign: 'center', marginTop: 20 },
  shareRow: { flexDirection: 'row', gap: 12, marginTop: 16, width: '100%', maxWidth: 360 },
  shareBtn: { flex: 2, borderRadius: 16, paddingVertical: 14, alignItems: 'center' },
  shareBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  closeBtn: { flex: 1, borderRadius: 16, paddingVertical: 14, alignItems: 'center', backgroundColor: LUCY_COLORS.surfaceRaised, borderWidth: 1, borderColor: LUCY_COLORS.border },
  closeBtnText: { color: LUCY_COLORS.textMuted, fontSize: 15, fontWeight: '700' },
});
