/**
 * ConversationModal — in-place overlay that slides up from the bottom of the screen.
 * The home screen stays visible behind a translucent backdrop; Lucy's panel sits at the
 * bottom ~260px. Drives the conversation engine (src/voice/conversation.ts): on open it
 * starts the listen→think→speak loop; it renders the current state, Lucy's last reply,
 * the user's live partial, and an End button. Opened by the wake word or the Talk button.
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
  onNavigate?: (section: string) => void;
  onClose: () => void;
  initialText?: string;
}

export default function ConversationModal({
  visible,
  context,
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

  // Subscribe to the conversation engine while mounted.
  useEffect(() => conversation.subscribe(setSnap), []);

  // Start the conversation loop on open, stop it on close.
  useEffect(() => {
    if (visible) void conversation.start({ context, onNavigate, initialText });
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

  const close = (): void => {
    void conversation.end();
    onClose();
  };

  // Find the last message Lucy spoke.
  const lastLucyTurn = [...snap.turns].reverse().find((t) => t.role === 'lucy');

  if (!visible && snap.state === 'off') return null;

  return (
    <View style={styles.container} pointerEvents="box-none">
      {/* Backdrop — absorbs taps above the panel but does NOT close Lucy
          (she might still be speaking). */}
      <Pressable style={styles.backdrop} />

      {/* Sliding panel */}
      <Animated.View style={[styles.panel, { transform: [{ translateY: slideY }] }]}>
        {/* Amber glow line + glow strip at the very top of the panel */}
        <View style={styles.glowStrip} />

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
            </View>
          )}
        </View>

        {/* Lucy's last message */}
        <View style={styles.lucyTextWrap}>
          {lastLucyTurn ? (
            <Text style={styles.lucyText}>{lastLucyTurn.text}</Text>
          ) : snap.state === 'listening' ? (
            <Text style={styles.lucyPlaceholder}>What's up?</Text>
          ) : null}
        </View>

        {/* User's live partial transcript */}
        {snap.partial ? (
          <Text style={styles.partialText}>{snap.partial}</Text>
        ) : null}

        {/* Error notice */}
        {snap.error ? (
          <Text style={styles.errorText}>{snap.error}</Text>
        ) : null}

        {/* End button */}
        <Pressable
          style={({ pressed }) => [styles.endBtn, pressed && styles.endBtnPressed]}
          onPress={close}
        >
          <Text style={styles.endBtnText}>End conversation</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const PANEL_HEIGHT = 260;

const styles = StyleSheet.create({
  // Covers entire screen; positioned absolute so home screen is visible behind it.
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 150,
    justifyContent: 'flex-end',
  },

  // Semi-transparent backdrop above the panel — does not dismiss Lucy.
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },

  // Sliding bottom panel.
  panel: {
    minHeight: PANEL_HEIGHT,
    backgroundColor: 'rgba(12, 8, 18, 0.96)',
    borderTopWidth: 1.5,
    borderTopColor: 'rgba(255, 140, 0, 0.6)',
    paddingBottom: 34, // iPhone safe-area bottom
    paddingHorizontal: 20,
  },

  // Thin warm glow strip immediately below the top border.
  glowStrip: {
    height: 12,
    backgroundColor: 'rgba(255, 120, 0, 0.08)',
    marginHorizontal: -20,
    marginBottom: 8,
  },

  // Row that shows the current state indicator.
  stateRow: {
    minHeight: 24,
    justifyContent: 'center',
    marginBottom: 10,
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
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 0.2,
  },

  // Lucy's last reply text area.
  lucyTextWrap: {
    flex: 1,
    justifyContent: 'center',
    marginBottom: 8,
  },
  lucyText: {
    color: C.textDark,
    fontSize: 17,
    lineHeight: 24,
  },
  lucyPlaceholder: {
    color: C.textSubtle,
    fontSize: 17,
    lineHeight: 24,
    fontStyle: 'italic',
  },

  // User's live partial transcript.
  partialText: {
    color: '#F59E0B',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 6,
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
    paddingVertical: 14,
    marginTop: 4,
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
