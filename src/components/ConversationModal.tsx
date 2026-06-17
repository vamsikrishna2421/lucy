/**
 * ConversationModal — a NON-BLOCKING floating card that slides up near the bottom of the screen.
 * The container is pointerEvents="box-none" so the rest of the app stays fully usable while Lucy
 * is active (e.g. navigating during a live demo) — only the card itself captures taps. Drives the
 * conversation engine (src/voice/conversation.ts): on open it starts the listen→think→speak loop;
 * it renders the current state, Lucy's last reply, the user's live partial, and an End button.
 * Opened by the wake word or the Talk button.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LUCY_COLORS as C } from '../config/colors';
import { conversation, type ConvoSnapshot } from '../voice/conversation';

interface Props {
  visible: boolean;
  context?: string;
  getContext?: () => string;
  onNavigate?: (section: string) => void;
  onClose: () => void;
  initialText?: string;
}

export default function ConversationModal({
  visible,
  context,
  getContext,
  onNavigate,
  onClose,
  initialText,
}: Props): React.ReactElement | null {
  const [snap, setSnap] = useState<ConvoSnapshot>({
    state: 'off',
    turns: [],
    partial: '',
    error: null,
  });

  // Slide-up translation: 300 = off-screen below panel, 0 = fully visible.
  const slideY = useRef(new Animated.Value(300)).current;
  // Dot opacity for the "thinking" pulsing animation.
  const dotOpacity = useRef(new Animated.Value(1)).current;
  const dotLoop = useRef<Animated.CompositeAnimation | null>(null);
  // Seconds left before the card self-dismisses after Lucy ends the conversation (null = not counting).
  const AUTO_DISMISS_SECONDS = 15;
  const [dismissIn, setDismissIn] = useState<number | null>(null);

  // Subscribe to the conversation engine while mounted.
  useEffect(() => conversation.subscribe(setSnap), []);

  // Start the conversation loop on open, stop it on close.
  useEffect(() => {
    if (visible) void conversation.start({ context, getContext, onNavigate, initialText });
    else void conversation.end();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Slide the panel up/down when visibility changes.
  useEffect(() => {
    Animated.spring(slideY, {
      toValue: visible ? 0 : 300,
      useNativeDriver: true,
      tension: 68,
      friction: 12,
    }).start();
  }, [visible, slideY]);

  // Pulse the thinking dots when state === 'thinking'.
  useEffect(() => {
    if (snap.state === 'thinking') {
      dotLoop.current = Animated.loop(
        Animated.sequence([
          Animated.timing(dotOpacity, {
            toValue: 0.2,
            duration: 500,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(dotOpacity, {
            toValue: 1,
            duration: 500,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      );
      dotLoop.current.start();
    } else {
      dotLoop.current?.stop();
      dotOpacity.setValue(1);
    }
    return () => { dotLoop.current?.stop(); };
  }, [snap.state, dotOpacity]);

  // When Lucy ends the conversation herself (engine → 'off') but the card is still on screen,
  // keep her sign-off visible briefly, then auto-dismiss with a visible countdown so the user
  // isn't left wondering whether they must tap something.
  useEffect(() => {
    if (!(visible && snap.state === 'off')) { setDismissIn(null); return; }
    setDismissIn(AUTO_DISMISS_SECONDS);
    const id = setInterval(() => {
      setDismissIn((n) => (n === null ? null : n - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [visible, snap.state]);

  // Fire the close once the countdown reaches zero.
  useEffect(() => {
    if (dismissIn === 0) onClose();
  }, [dismissIn, onClose]);

  const close = (): void => {
    void conversation.end();
    onClose();
  };

  // Find the last message Lucy spoke.
  const lastLucyTurn = [...snap.turns].reverse().find((t) => t.role === 'lucy');

  if (!visible && snap.state === 'off') return null;

  return (
    // box-none: touches pass straight through the empty area to the app behind, so the
    // user can keep navigating during a live demo. Only the panel itself captures taps.
    <View style={styles.container} pointerEvents="box-none">
      {/* Floating panel — non-blocking, hovers above the bottom nav */}
      <Animated.View style={[styles.panel, { transform: [{ translateY: slideY }] }]}>
        {/* Amber glow line + glow strip at the very top of the panel */}
        <View style={styles.glowStrip} />

        {/* Tap the message area while Lucy is speaking to take over (barge-in). */}
        <Pressable
          onPress={() => { if (snap.state === 'speaking') conversation.interrupt(); }}
          disabled={snap.state !== 'speaking'}
        >
          {/* State indicator row */}
          <View style={styles.stateRow}>
            {snap.state === 'thinking' && (
              <Animated.Text style={[styles.stateThinking, { opacity: dotOpacity }]}>
                {'●●●'}
              </Animated.Text>
            )}
            {snap.state === 'listening' && (
              <View style={styles.stateInlineRow}>
                <View style={[styles.stateDot, { backgroundColor: '#4ADE80' }]} />
                <Text style={styles.stateText}>Listening…</Text>
              </View>
            )}
            {snap.state === 'speaking' && (
              <View style={styles.stateInlineRow}>
                <View style={[styles.stateDot, { backgroundColor: C.primary }]} />
                <Text style={styles.stateText}>Speaking…</Text>
                <Text style={styles.tapHint}>· tap to reply</Text>
              </View>
            )}
          </View>

          {/* Lucy's last message (capped so the card stays compact) */}
          <View style={styles.lucyTextWrap}>
            {lastLucyTurn ? (
              <Text style={styles.lucyText} numberOfLines={3}>{lastLucyTurn.text}</Text>
            ) : snap.state === 'listening' ? (
              <Text style={styles.lucyPlaceholder}>What's up?</Text>
            ) : null}
          </View>

          {/* User's live partial transcript */}
          {snap.partial ? (
            <Text style={styles.partialText} numberOfLines={2}>{snap.partial}</Text>
          ) : null}
        </Pressable>

        {/* Error notice */}
        {snap.error ? (
          <Text style={styles.errorText}>{snap.error}</Text>
        ) : null}

        {/* End button */}
        <Pressable
          style={({ pressed }) => [styles.endBtn, pressed && styles.endBtnPressed]}
          onPress={close}
        >
          <Text style={styles.endBtnText}>
            {dismissIn !== null ? `Closing in ${dismissIn}s · tap to close now` : 'End conversation'}
          </Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Covers entire screen; box-none so empty space passes touches through to the app.
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 150,
    justifyContent: 'flex-end',
  },

  // Compact floating card pinned near the bottom but ABOVE the nav, so the app stays usable.
  panel: {
    backgroundColor: 'rgba(12, 8, 18, 0.97)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 140, 0, 0.55)',
    borderRadius: 20,
    marginHorizontal: 14,
    marginBottom: 100, // clear the bottom nav / mic button
    paddingBottom: 2,
    paddingHorizontal: 16,
    paddingTop: 2,
    shadowColor: '#FF8C00',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 18,
    elevation: 12,
  },

  // Thin warm glow strip at the top of the card.
  glowStrip: {
    height: 8,
    backgroundColor: 'rgba(255, 120, 0, 0.08)',
    marginHorizontal: -16,
    marginTop: -2,
    marginBottom: 4,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },

  // Row that shows the current state indicator.
  stateRow: {
    minHeight: 20,
    justifyContent: 'center',
    marginBottom: 6,
  },

  // Pulsing thinking dots.
  stateThinking: {
    color: C.gold,
    fontSize: 16,
    letterSpacing: 4,
  },

  // Row with a colored dot + label (listening / speaking).
  stateInlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  stateDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  stateText: {
    color: C.textMuted,
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.2,
  },
  // "· tap to reply" hint shown while Lucy is speaking.
  tapHint: {
    color: C.primary,
    fontSize: 12,
    fontWeight: '500',
  },

  // Lucy's last reply text area.
  lucyTextWrap: {
    justifyContent: 'center',
    marginBottom: 6,
  },
  lucyText: {
    color: C.textDark,
    fontSize: 15,
    lineHeight: 21,
  },
  lucyPlaceholder: {
    color: C.textSubtle,
    fontSize: 15,
    lineHeight: 21,
    fontStyle: 'italic',
  },

  // User's live partial transcript.
  partialText: {
    color: '#F59E0B',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 4,
  },

  // Error notice.
  errorText: {
    color: C.error,
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 4,
  },

  // End conversation button.
  endBtn: {
    alignItems: 'center',
    paddingVertical: 10,
    marginTop: 2,
  },
  endBtnPressed: {
    opacity: 0.6,
  },
  endBtnText: {
    color: C.primary,
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});
