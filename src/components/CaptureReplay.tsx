/**
 * Live Capture Replay — the "wow moment"
 *
 * After LUCY processes a capture, this component animates the extracted
 * artifacts appearing one by one for 4-5 seconds, making the invisible visible.
 * Shows: task card drops in, person lights up, expense chip appears.
 * Then collapses naturally into the Board.
 */

import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { LUCY_COLORS } from '../config/colors';
import type { ExtractionResult } from '../types/extraction';

interface ReplayItem {
  icon: string;
  label: string;
  color: string;
}

function buildReplayItems(extraction: ExtractionResult): ReplayItem[] {
  const items: ReplayItem[] = [];
  for (const task of extraction.tasks.slice(0, 2)) {
    items.push({ icon: '✓', label: task.task, color: LUCY_COLORS.primary });
  }
  for (const expense of extraction.expenses.slice(0, 1)) {
    items.push({ icon: '$', label: `${expense.amount} — ${expense.description}`, color: '#4ADE80' });
  }
  for (const person of extraction.people.slice(0, 2)) {
    items.push({ icon: '◉', label: person, color: '#60A5FA' });
  }
  for (const reminder of extraction.reminders.slice(0, 1)) {
    items.push({ icon: '⏰', label: reminder.text, color: '#F59E0B' });
  }
  for (const loop of extraction.open_loops.slice(0, 1)) {
    items.push({ icon: '↩', label: loop.description, color: LUCY_COLORS.textMuted });
  }
  for (const fu of extraction.follow_ups.slice(0, 1)) {
    items.push({ icon: '→', label: `${fu.assignee}: ${fu.action}`, color: '#FFA05C' });
  }
  for (const decision of extraction.decisions.slice(0, 1)) {
    items.push({ icon: '⚡', label: decision, color: '#A78BFA' });
  }
  return items.slice(0, 5); // max 5 items
}

function AnimatedChip({ item, delay }: { item: ReplayItem; delay: number }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(12)).current;

  useEffect(() => {
    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 280, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.spring(translateY, { toValue: 0, friction: 8, useNativeDriver: true }),
      ]).start();
    }, delay);
    return () => clearTimeout(timer);
  }, []);

  return (
    <Animated.View style={[styles.chip, { opacity, transform: [{ translateY }], borderColor: item.color + '44' }]}>
      <Text style={[styles.chipIcon, { color: item.color }]}>{item.icon}</Text>
      <Text style={styles.chipLabel} numberOfLines={1}>{item.label}</Text>
    </Animated.View>
  );
}

interface Props {
  extraction: ExtractionResult | null;
  onDismiss: () => void;
}

export function CaptureReplay({ extraction, onDismiss }: Props) {
  const containerOpacity = useRef(new Animated.Value(0)).current;
  const [autoClose, setAutoClose] = useState(false);

  useEffect(() => {
    if (!extraction) return;

    // Fade in
    Animated.timing(containerOpacity, { toValue: 1, duration: 300, useNativeDriver: true }).start();

    // Auto-dismiss after 4.5 seconds
    const timer = setTimeout(() => {
      Animated.timing(containerOpacity, { toValue: 0, duration: 400, useNativeDriver: true }).start(() => onDismiss());
    }, 4500);

    return () => clearTimeout(timer);
  }, [extraction]);

  if (!extraction) return null;

  const items = buildReplayItems(extraction);
  if (items.length === 0) return null;

  return (
    <Modal transparent animationType="none" visible onRequestClose={onDismiss}>
      <Pressable style={styles.backdrop} onPress={onDismiss}>
        <Animated.View style={[styles.card, { opacity: containerOpacity }]}>
          <View style={styles.header}>
            <View style={styles.pulseDot} />
            <Text style={styles.headerText}>LUCY extracted</Text>
          </View>
          <Text style={styles.title} numberOfLines={2}>
            {extraction.title || 'Your capture'}
          </Text>
          <View style={styles.chips}>
            {items.map((item, i) => (
              <AnimatedChip key={i} item={item} delay={300 + i * 220} />
            ))}
          </View>
          <Text style={styles.tapHint}>tap to dismiss</Text>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end', paddingBottom: 100,
  },
  card: {
    backgroundColor: LUCY_COLORS.surface,
    borderRadius: 24, borderWidth: 1, borderColor: LUCY_COLORS.border,
    marginHorizontal: 20, padding: 22, gap: 12,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pulseDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: LUCY_COLORS.primary,
  },
  headerText: {
    fontSize: 11, fontWeight: '800', letterSpacing: 1.5,
    color: LUCY_COLORS.primary, textTransform: 'uppercase',
  },
  title: { fontSize: 17, fontWeight: '700', color: LUCY_COLORS.textDark, lineHeight: 24 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: LUCY_COLORS.surfaceRaised,
    borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7,
    maxWidth: '90%',
  },
  chipIcon: { fontSize: 13, fontWeight: '700' },
  chipLabel: { fontSize: 13, color: LUCY_COLORS.textDark, fontWeight: '500', flex: 1 },
  tapHint: { fontSize: 11, color: LUCY_COLORS.textSubtle, textAlign: 'center', marginTop: 4 },
});
