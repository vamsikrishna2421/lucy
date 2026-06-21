import { useRef, useState } from 'react';
import { Animated, Dimensions, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LUCY_COLORS, LUCY_SHADOWS } from '../config/colors';

const { width: SW } = Dimensions.get('window');

interface Slide { title: string; subtitle: string; body: string; accent: string; tour?: boolean }

const SLIDES: Slide[] = [
  {
    title: 'Meet LUCY',
    subtitle: 'Your private second brain',
    body: 'LUCY quietly captures your thoughts, connects your memories, and surfaces what matters — without you having to organize anything.',
    accent: 'Listen · Understand · Connect · Yield',
  },
  {
    title: 'Just say it',
    subtitle: 'No structure required',
    body: 'Type or speak naturally. "Had a meeting with Sam about Q3, need to follow up Friday" → LUCY extracts tasks, people, and follow-ups automatically.',
    accent: 'Your words, LUCY\'s work',
  },
  {
    title: 'Ask anything',
    subtitle: 'Your memory, on demand',
    body: 'Tap Ask and type any question. "What did I work on this week?" "Who am I meeting tomorrow?" "What\'s my battery level?" LUCY knows.',
    accent: 'Everything stays on your device',
  },
  {
    title: 'Want a guided tour?',
    subtitle: 'Learn by doing, with Lucy',
    body: 'Lucy can walk you through the app out loud — you try each feature live as she explains. It only takes a couple of minutes.',
    accent: 'You can stop anytime',
    tour: true,
  },
];

export function Onboarding({ visible, onComplete }: { visible: boolean; onComplete: (startTour: boolean) => void }) {
  const [page, setPage] = useState(0);
  const slideAnim = useRef(new Animated.Value(0)).current;

  const goNext = () => {
    if (page < SLIDES.length - 1) {
      Animated.timing(slideAnim, { toValue: -(page + 1) * SW, duration: 300, useNativeDriver: true }).start();
      setPage(page + 1);
    } else {
      onComplete(false);
    }
  };

  const slide = SLIDES[page];

  return (
    <Modal transparent animationType="fade" visible={visible}>
      <View style={styles.container}>
        <View style={styles.card}>
          {/* Logo */}
          <View style={styles.logoRow}>
            <Text style={styles.logo}>LUC<Text style={{ color: LUCY_COLORS.primary }}>Y</Text></Text>
          </View>

          {/* Slide content */}
          <Text style={styles.title}>{slide.title}</Text>
          <Text style={styles.subtitle}>{slide.subtitle}</Text>
          <Text style={styles.body}>{slide.body}</Text>
          <View style={styles.accentBar}>
            <Text style={styles.accentText}>{slide.accent}</Text>
          </View>

          {/* Progress dots */}
          <View style={styles.dots}>
            {SLIDES.map((_, i) => (
              <View key={i} style={[styles.dot, i === page && styles.dotActive]} />
            ))}
          </View>

          {/* Buttons */}
          {slide.tour ? (
            <>
              <TouchableOpacity style={styles.btn} onPress={() => onComplete(true)}>
                <Text style={styles.btnText}>Start the tour</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => onComplete(false)} style={styles.skip}>
                <Text style={styles.skipText}>Maybe later</Text>
              </TouchableOpacity>
              <Text style={styles.settingsNote}>
                You can start it anytime from Settings → "Guided tour with Lucy".
              </Text>
            </>
          ) : (
            <>
              <TouchableOpacity style={styles.btn} onPress={goNext}>
                <Text style={styles.btnText}>Next</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => onComplete(false)} style={styles.skip}>
                <Text style={styles.skipText}>Skip</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'rgba(20,22,40,0.40)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  card: {
    backgroundColor: LUCY_COLORS.surface,
    borderRadius: 24,
    padding: 32,
    width: '100%',
    maxWidth: 380,
    borderWidth: 1,
    borderColor: LUCY_COLORS.border,
    ...LUCY_SHADOWS.lg,
  },
  logoRow: { alignItems: 'center', marginBottom: 28 },
  logo: { fontSize: 36, fontWeight: '900', letterSpacing: 2, color: LUCY_COLORS.textDark },
  title: { fontSize: 28, fontWeight: '800', color: LUCY_COLORS.textDark, marginBottom: 6, letterSpacing: -0.5 },
  subtitle: { fontSize: 15, color: LUCY_COLORS.primary, fontWeight: '700', marginBottom: 16 },
  body: { fontSize: 15, color: LUCY_COLORS.textMuted, lineHeight: 24, marginBottom: 20 },
  accentBar: { backgroundColor: LUCY_COLORS.primarySoft, borderRadius: 10, padding: 12, marginBottom: 28 },
  accentText: { color: LUCY_COLORS.primaryGlow, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 24 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: LUCY_COLORS.border },
  dotActive: { backgroundColor: LUCY_COLORS.primary, width: 22 },
  btn: { backgroundColor: LUCY_COLORS.primary, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginBottom: 12 },
  btnText: { color: LUCY_COLORS.white, fontSize: 16, fontWeight: '700' },
  skip: { alignItems: 'center', paddingVertical: 6 },
  skipText: { color: LUCY_COLORS.textSubtle, fontSize: 14 },
  settingsNote: { color: LUCY_COLORS.textSubtle, fontSize: 12, textAlign: 'center', marginTop: 10, lineHeight: 17 },
});
