/**
 * ReviewCardDeck — a full-screen, one-card-at-a-time review surface (Need-Context, approval proposals,
 * any review queue). Horizontal swipe via RN's built-in PanResponder + Animated (NO native gesture libs,
 * so it ships over-the-air). Back/Next buttons as a fallback, progress dots, and an "N left" counter.
 *
 * Generic: pass `cards` (key + a render fn). The deck owns the current index and the swipe animation;
 * when the parent removes an actioned card from the array, the deck clamps + advances automatically.
 */
import { useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, PanResponder, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LUCY_COLORS } from '../config/colors';
import { LucyPeek } from './LucyPeek';

export interface ReviewCard {
  key: string;
  render: () => React.ReactNode;
}

const { width: SCREEN_W } = Dimensions.get('window');
const SWIPE_THRESHOLD = SCREEN_W * 0.28;

export function ReviewCardDeck({
  cards,
  emptyText = 'All caught up — nothing to review right now.',
  header,
}: {
  cards: ReviewCard[];
  emptyText?: string;
  header?: React.ReactNode;
}) {
  const [index, setIndex] = useState(0);
  const pan = useRef(new Animated.ValueXY()).current;

  // Keep the index valid as the parent removes actioned cards.
  useEffect(() => {
    if (index > cards.length - 1) setIndex(Math.max(0, cards.length - 1));
  }, [cards.length, index]);

  const animateTo = (dir: -1 | 1, then: () => void) => {
    Animated.timing(pan, { toValue: { x: dir * SCREEN_W, y: 0 }, duration: 180, useNativeDriver: true }).start(() => {
      pan.setValue({ x: 0, y: 0 });
      then();
    });
  };
  const goNext = () => { if (index < cards.length - 1) animateTo(-1, () => setIndex((i) => Math.min(cards.length - 1, i + 1))); };
  const goPrev = () => { if (index > 0) animateTo(1, () => setIndex((i) => Math.max(0, i - 1))); };

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderMove: (_e, g) => pan.setValue({ x: g.dx, y: 0 }),
      onPanResponderRelease: (_e, g) => {
        if (g.dx <= -SWIPE_THRESHOLD) goNext();
        else if (g.dx >= SWIPE_THRESHOLD) goPrev();
        else Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: true, bounciness: 6 }).start();
      },
    }),
  ).current;

  if (!cards.length) {
    return (
      <View style={styles.wrap}>
        {header}
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyEmoji}>✦</Text>
          <Text style={styles.emptyText}>{emptyText}</Text>
        </View>
      </View>
    );
  }

  const safeIndex = Math.min(index, cards.length - 1);
  const card = cards[safeIndex];
  const rotate = pan.x.interpolate({ inputRange: [-SCREEN_W, 0, SCREEN_W], outputRange: ['-7deg', '0deg', '7deg'] });

  return (
    <View style={styles.wrap}>
      {header}
      <View style={styles.progressRow}>
        <Text style={styles.counter}>{safeIndex + 1} of {cards.length}</Text>
        <View style={styles.dots}>
          {cards.slice(0, 12).map((c, i) => (
            <View key={c.key} style={[styles.dot, i === safeIndex && styles.dotActive]} />
          ))}
          {cards.length > 12 ? <Text style={styles.dotMore}>+{cards.length - 12}</Text> : null}
        </View>
      </View>

      <View style={styles.cardArea}>
        <Animated.View
          key={card.key}
          {...panResponder.panHandlers}
          style={[styles.card, { transform: [{ translateX: pan.x }, { rotate }] }]}
        >
          {/* LUCY peeks over the card's top edge, as if asking the question from behind it.
              Re-keyed per card so she pops up fresh on each review. Decorative only. */}
          <LucyPeek key={`peek-${card.key}`} />
          {card.render()}
        </Animated.View>
      </View>

      <View style={styles.navRow}>
        <TouchableOpacity style={[styles.navBtn, safeIndex === 0 && styles.navBtnDisabled]} disabled={safeIndex === 0} onPress={goPrev}>
          <Text style={styles.navText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.hint}>swipe to review</Text>
        <TouchableOpacity style={[styles.navBtn, safeIndex >= cards.length - 1 && styles.navBtnDisabled]} disabled={safeIndex >= cards.length - 1} onPress={goNext}>
          <Text style={styles.navText}>Next ›</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  progressRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, marginBottom: 8 },
  counter: { color: LUCY_COLORS.textMuted, fontSize: 13, fontWeight: '600' },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: LUCY_COLORS.border },
  dotActive: { backgroundColor: LUCY_COLORS.primary, width: 18 },
  dotMore: { color: LUCY_COLORS.textSubtle, fontSize: 11, marginLeft: 4 },
  cardArea: { flex: 1, justifyContent: 'center', paddingHorizontal: 16 },
  card: { minHeight: '62%', backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 24, borderWidth: 1, borderColor: LUCY_COLORS.border, padding: 22, paddingTop: 30, justifyContent: 'flex-start', overflow: 'visible' },
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 14 },
  navBtn: { paddingVertical: 9, paddingHorizontal: 16, borderRadius: 16, borderWidth: 1, borderColor: LUCY_COLORS.border, backgroundColor: LUCY_COLORS.surfaceRaised },
  navBtnDisabled: { opacity: 0.35 },
  navText: { color: LUCY_COLORS.textDark, fontWeight: '700', fontSize: 14 },
  hint: { color: LUCY_COLORS.textSubtle, fontSize: 12 },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  emptyEmoji: { fontSize: 34, marginBottom: 10 },
  emptyText: { color: LUCY_COLORS.textMuted, textAlign: 'center', fontSize: 15, lineHeight: 22 },
});
