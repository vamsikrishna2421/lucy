/**
 * ConversationModal — the full-screen "talk to LUCY" surface. Drives the conversation engine
 * (src/voice/conversation.ts): on open it starts the listen→think→speak loop; it renders the live
 * state (a pulsing orb), the running transcript, and the current partial; tapping End (or saying
 * "stop"/"that's all") closes it. Opened by the wake word or the Talk button.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated, Easing, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LUCY_COLORS as C } from '../config/colors';
import { conversation, type ConvoSnapshot } from '../voice/conversation';

interface Props {
  visible: boolean;
  context?: string;
  onNavigate?: (section: string) => void;
  onClose: () => void;
  initialText?: string;
}

const STATE_LABEL: Record<ConvoSnapshot['state'], string> = {
  off: 'Tap to start',
  listening: 'Listening…',
  thinking: 'Thinking…',
  speaking: 'Speaking…',
};

export default function ConversationModal({ visible, context, onNavigate, onClose, initialText }: Props): React.ReactElement {
  const [snap, setSnap] = useState<ConvoSnapshot>({ state: 'off', turns: [], partial: '', error: null });
  const pulse = useRef(new Animated.Value(0)).current;
  const scrollRef = useRef<ScrollView>(null);

  // Subscribe to the engine while mounted.
  useEffect(() => conversation.subscribe(setSnap), []);

  // Start the loop on open, stop it on close.
  useEffect(() => {
    if (visible) void conversation.start({ context, onNavigate, initialText });
    else void conversation.end();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Pulse animation reflects the active state.
  useEffect(() => {
    const active = snap.state === 'listening' || snap.state === 'speaking';
    if (active) {
      const loop = Animated.loop(Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]));
      loop.start();
      return () => loop.stop();
    }
    pulse.setValue(0);
    return undefined;
  }, [snap.state, pulse]);

  useEffect(() => { scrollRef.current?.scrollToEnd({ animated: true }); }, [snap.turns.length, snap.partial]);

  const close = (): void => { void conversation.end(); onClose(); };

  const hasContent = snap.turns.length > 0 || !!snap.partial;
  const orbColor = snap.state === 'speaking' ? C.primaryGlow : snap.state === 'thinking' ? C.gold : C.primary;
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] });
  const glowOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.55] });

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={close} statusBarTranslucent>
      <View style={styles.root}>
        <View style={styles.header}>
          <Text style={styles.title}>Talk to Lucy</Text>
          <TouchableOpacity onPress={close} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="close" size={26} color={C.textMuted} />
          </TouchableOpacity>
        </View>

        <View style={[styles.orbWrap, hasContent && styles.orbWrapCompact]}>
          <Animated.View style={[styles.orbGlow, hasContent && styles.orbGlowCompact, { backgroundColor: orbColor, opacity: glowOpacity, transform: [{ scale }] }]} />
          <Animated.View style={[styles.orb, hasContent && styles.orbCompact, { borderColor: orbColor, transform: [{ scale }] }]}>
            <Ionicons
              name={snap.state === 'speaking' ? 'volume-high' : snap.state === 'thinking' ? 'sparkles' : 'mic'}
              size={hasContent ? 28 : 42}
              color={orbColor}
            />
          </Animated.View>
          <Text style={[styles.stateLabel, { color: orbColor }]}>{STATE_LABEL[snap.state]}</Text>
        </View>

        <ScrollView ref={scrollRef} style={styles.transcript} contentContainerStyle={{ paddingBottom: 16 }}>
          {snap.turns.length === 0 && !snap.partial ? (
            <Text style={styles.hint}>
              Speak naturally — ask a question, or tell me to schedule, remember, or add something.
              Say “that’s all” when you’re done.
            </Text>
          ) : null}
          {snap.turns.map((t, i) => (
            <View key={i} style={[styles.bubble, t.role === 'user' ? styles.userBubble : styles.lucyBubble]}>
              <Text style={[styles.bubbleRole, { color: t.role === 'user' ? C.textSubtle : C.primary }]}>
                {t.role === 'user' ? 'You' : 'Lucy'}
              </Text>
              <Text style={styles.bubbleText}>{t.text}</Text>
            </View>
          ))}
          {snap.partial ? (
            <View style={[styles.bubble, styles.userBubble, { opacity: 0.55 }]}>
              <Text style={[styles.bubbleRole, { color: C.textSubtle }]}>You</Text>
              <Text style={styles.bubbleText}>{snap.partial}…</Text>
            </View>
          ) : null}
        </ScrollView>

        {snap.error ? <Text style={styles.error}>{snap.error}</Text> : null}

        <TouchableOpacity style={styles.endBtn} onPress={close} activeOpacity={0.85}>
          <Ionicons name="stop-circle" size={22} color={C.white} />
          <Text style={styles.endLabel}>End conversation</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.background, paddingTop: 54, paddingHorizontal: 20 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  title: { color: C.textDark, fontSize: 20, fontWeight: '700' },
  orbWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 28 },
  orbWrapCompact: { paddingVertical: 8 },
  orbGlow: { position: 'absolute', width: 150, height: 150, borderRadius: 75, top: 28 },
  orbGlowCompact: { width: 70, height: 70, borderRadius: 35, top: 4 },
  orb: {
    width: 116, height: 116, borderRadius: 58, borderWidth: 2,
    backgroundColor: C.surfaceRaised, alignItems: 'center', justifyContent: 'center',
  },
  orbCompact: { width: 52, height: 52, borderRadius: 26 },
  stateLabel: { marginTop: 18, fontSize: 15, fontWeight: '600', letterSpacing: 0.3 },
  transcript: { flex: 1, marginTop: 4 },
  hint: { color: C.textSubtle, fontSize: 14, lineHeight: 21, textAlign: 'center', paddingHorizontal: 12, marginTop: 24 },
  bubble: { borderRadius: 16, paddingVertical: 10, paddingHorizontal: 14, marginVertical: 5, maxWidth: '88%' },
  userBubble: { alignSelf: 'flex-end', backgroundColor: C.surfaceRaised },
  lucyBubble: { alignSelf: 'flex-start', backgroundColor: C.primarySoft, borderWidth: 1, borderColor: C.primaryLine },
  bubbleRole: { fontSize: 11, fontWeight: '700', marginBottom: 3, letterSpacing: 0.4, textTransform: 'uppercase' },
  bubbleText: { color: C.textDark, fontSize: 15, lineHeight: 21 },
  error: { color: C.error, fontSize: 13, textAlign: 'center', marginBottom: 8 },
  endBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.primaryDeep, borderRadius: 30, paddingVertical: 15, marginBottom: 28, marginTop: 6,
  },
  endLabel: { color: C.white, fontSize: 16, fontWeight: '700' },
});
