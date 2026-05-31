import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { LUCY_COLORS } from '../config/colors';
import { passiveListener } from '../audio/PassiveListener';
import { generateMeetingSummary, saveMeetingToMemory, type MeetingSummary } from '../processing/meetingMode';
import { getDatabase } from '../db';

type MeetingPhase = 'idle' | 'naming' | 'recording' | 'processing' | 'summary';

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export function MeetingMode({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [phase, setPhase] = useState<MeetingPhase>('idle');
  const [meetingTitle, setMeetingTitle] = useState('');
  const [startedAt, setStartedAt] = useState<Date | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [summary, setSummary] = useState<MeetingSummary | null>(null);
  const [savedToMemory, setSavedToMemory] = useState(false);

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const timerRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  // Live word count from passive listener
  useEffect(() => {
    return passiveListener.subscribe((state) => {
      if (phase === 'recording') {
        setElapsed(state.sessionStartedAt ? Date.now() - state.sessionStartedAt : 0);
      }
    });
  }, [phase]);

  // Pulse animation when recording
  useEffect(() => {
    if (phase === 'recording') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.2, duration: 700, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1,   duration: 700, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [phase]);

  // Duration counter
  useEffect(() => {
    if (phase === 'recording') {
      timerRef.current = setInterval(() => {
        setElapsed(startedAt ? Date.now() - startedAt.getTime() : 0);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [phase, startedAt]);

  const startMeeting = async () => {
    const title = meetingTitle.trim() || 'Meeting';
    setMeetingTitle(title);
    setStartedAt(new Date());
    setElapsed(0);
    setPhase('recording');
    await passiveListener.start();
  };

  const stopMeeting = async () => {
    setPhase('processing');
    // Grab the accumulated transcript BEFORE stopping (stop flushes the buffer)
    const rawTranscript = passiveListener.getAccumulatedTranscript();
    await passiveListener.stop();
    passiveListener.clearTranscript();
    const durationMs = startedAt ? Date.now() - startedAt.getTime() : 0;

    let gen: Awaited<ReturnType<typeof generateMeetingSummary>> = null;
    try {
      const db = await getDatabase();
      gen = await generateMeetingSummary(
        rawTranscript || `Meeting lasted ${formatDuration(durationMs)} but no speech was captured.`,
        meetingTitle,
        db,
      );
      setSummary(gen);
    } catch { /* show empty summary */ }

    setPhase('summary');
    // Auto-save immediately — user still sees the summary and can dismiss.
    // They no longer need to tap "Save to LUCY Memory" for the meeting to be stored.
    if (gen && startedAt) {
      void saveMeetingToMemory(gen, meetingTitle, Date.now() - startedAt.getTime()).catch(() => {});
    }
  };

  const saveAndClose = async () => {
    if (summary && startedAt) {
      await saveMeetingToMemory(summary, meetingTitle, Date.now() - startedAt.getTime());
      setSavedToMemory(true);
    }
    setTimeout(() => {
      setPhase('idle');
      setMeetingTitle('');
      setSummary(null);
      setSavedToMemory(false);
      onClose();
    }, 1000);
  };

  const handleClose = () => {
    if (phase === 'recording') {
      void stopMeeting();
      return;
    }
    setPhase('idle');
    setMeetingTitle('');
    setSummary(null);
    onClose();
  };

  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={handleClose}>
      <Pressable style={styles.backdrop} onPress={phase === 'idle' ? handleClose : undefined}>
        <Pressable style={styles.sheet}>

          {/* IDLE / NAMING phase */}
          {(phase === 'idle' || phase === 'naming') && (
            <>
              <Text style={styles.sheetTitle}>Start Meeting Mode</Text>
              <Text style={styles.sheetSub}>
                LUCY will listen and transcribe your meeting privately on this device.
                Invisible to other participants — just like taking notes.
              </Text>
              <TextInput
                style={styles.titleInput}
                placeholder="Meeting name (optional)"
                placeholderTextColor={LUCY_COLORS.textSubtle}
                value={meetingTitle}
                onChangeText={setMeetingTitle}
                onFocus={() => setPhase('naming')}
                returnKeyType="done"
              />
              <TouchableOpacity style={styles.startBtn} onPress={() => void startMeeting()}>
                <Text style={styles.startBtnText}>Start listening</Text>
              </TouchableOpacity>
              <Text style={styles.disclaimer}>
                Orange indicator will appear on your screen (iOS requirement). Other participants cannot see it.
              </Text>
            </>
          )}

          {/* RECORDING phase */}
          {phase === 'recording' && (
            <>
              <View style={styles.recordingHeader}>
                <Animated.View style={[styles.recordDot, { transform: [{ scale: pulseAnim }] }]} />
                <Text style={styles.recordingLabel}>Recording meeting</Text>
              </View>
              <Text style={styles.meetingTitleDisplay}>{meetingTitle || 'Meeting'}</Text>
              <Text style={styles.durationDisplay}>{formatDuration(elapsed)}</Text>
              <Text style={styles.wordCount}>{(() => {
                const s = passiveListener.getState();
                if (s.noApiKey) return 'Enable Remote Intelligence in Settings to count words';
                if (s.mode === 'batch' && s.wordsHeard === 0) {
                  const sec = s.recordingSeconds;
                  return sec < 60 ? `Recording... ${sec}s` : `Recording... ${Math.floor(sec / 60)}m${sec % 60 > 0 ? `${sec % 60}s` : ''}`;
                }
                return `${s.wordsHeard} words captured`;
              })()}</Text>
              <TouchableOpacity style={styles.stopBtn} onPress={() => void stopMeeting()}>
                <View style={styles.stopIcon} />
                <Text style={styles.stopBtnText}>End meeting</Text>
              </TouchableOpacity>
            </>
          )}

          {/* PROCESSING phase */}
          {phase === 'processing' && (
            <View style={styles.processingWrap}>
              <Text style={styles.processingTitle}>LUCY is summarizing...</Text>
              <Text style={styles.processingSub}>Extracting decisions, action items, and follow-ups</Text>
            </View>
          )}

          {/* SUMMARY phase */}
          {phase === 'summary' && (
            <>
              <Text style={styles.sheetTitle}>{meetingTitle || 'Meeting'}</Text>
              <Text style={styles.durationSmall}>Duration: {formatDuration(elapsed)}</Text>
              <ScrollView style={styles.summaryScroll} showsVerticalScrollIndicator={false}>
                {summary ? (
                  <>
                    <Text style={styles.headline}>{summary.headline}</Text>

                    {summary.keyDecisions.length > 0 && (
                      <SummarySection title="Decisions" items={summary.keyDecisions} />
                    )}
                    {summary.actionItems.length > 0 && (
                      <>
                        <Text style={styles.sectionLabel}>Action Items</Text>
                        {summary.actionItems.map((a, i) => (
                          <View key={i} style={styles.actionItem}>
                            <View style={styles.actionDot} />
                            <Text style={styles.actionText}>
                              {a.task}
                              {a.owner ? <Text style={styles.actionOwner}> → {a.owner}</Text> : null}
                              {a.deadline ? <Text style={styles.actionDeadline}> · {a.deadline}</Text> : null}
                            </Text>
                          </View>
                        ))}
                      </>
                    )}
                    {summary.openQuestions.length > 0 && (
                      <SummarySection title="Open Questions" items={summary.openQuestions} />
                    )}
                    {summary.nextSteps ? (
                      <>
                        <Text style={styles.sectionLabel}>Next Steps</Text>
                        <Text style={styles.nextStepsText}>{summary.nextSteps}</Text>
                      </>
                    ) : null}
                    {summary.attendeesMentioned.length > 0 && (
                      <Text style={styles.attendees}>
                        Mentioned: {summary.attendeesMentioned.join(', ')}
                      </Text>
                    )}
                    {summary.speakerNotes ? (
                      <View style={{ marginTop: 12, backgroundColor: 'rgba(255,140,66,0.07)', borderRadius: 10, padding: 10 }}>
                        <Text style={{ color: LUCY_COLORS.primary, fontSize: 10, fontWeight: '800', letterSpacing: 1, marginBottom: 4 }}>SPEAKER CONTEXT</Text>
                        <Text style={{ color: LUCY_COLORS.textMuted, fontSize: 13, lineHeight: 20 }}>{summary.speakerNotes}</Text>
                      </View>
                    ) : null}
                  </>
                ) : (
                  <Text style={styles.noSummary}>
                    Summary requires Remote Intelligence (Settings → Remote intelligence). The meeting has been saved to your captures.
                  </Text>
                )}
              </ScrollView>
              <TouchableOpacity style={[styles.startBtn, savedToMemory && styles.savedBtn]} onPress={() => void saveAndClose()}>
                <Text style={styles.startBtnText}>{savedToMemory ? 'Saved to memory ✓' : 'Save to LUCY memory'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.dismissBtn} onPress={handleClose}>
                <Text style={styles.dismissText}>Dismiss</Text>
              </TouchableOpacity>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function SummarySection({ title, items }: { title: string; items: string[] }) {
  return (
    <>
      <Text style={styles.sectionLabel}>{title}</Text>
      {items.map((item, i) => (
        <View key={i} style={styles.summaryItem}>
          <View style={styles.summaryBullet} />
          <Text style={styles.summaryItemText}>{item}</Text>
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: LUCY_COLORS.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 28,
    paddingBottom: 40,
    borderTopWidth: 1,
    borderTopColor: LUCY_COLORS.border,
    maxHeight: '85%',
  },
  sheetTitle: { color: LUCY_COLORS.textDark, fontSize: 22, fontWeight: '800', marginBottom: 8 },
  sheetSub: { color: LUCY_COLORS.textMuted, fontSize: 14, lineHeight: 21, marginBottom: 20 },
  titleInput: {
    backgroundColor: LUCY_COLORS.surfaceRaised,
    borderWidth: 1,
    borderColor: LUCY_COLORS.border,
    borderRadius: 14,
    padding: 14,
    color: LUCY_COLORS.textDark,
    fontSize: 16,
    marginBottom: 16,
  },
  startBtn: { backgroundColor: LUCY_COLORS.primary, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginBottom: 12 },
  savedBtn: { backgroundColor: LUCY_COLORS.success },
  startBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  disclaimer: { color: LUCY_COLORS.textSubtle, fontSize: 12, textAlign: 'center', lineHeight: 18 },
  // Recording
  recordingHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  recordDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#ef4444' },
  recordingLabel: { color: '#ef4444', fontSize: 14, fontWeight: '700' },
  meetingTitleDisplay: { color: LUCY_COLORS.textDark, fontSize: 24, fontWeight: '800', marginBottom: 8 },
  durationDisplay: { fontSize: 48, fontWeight: '900', color: LUCY_COLORS.primary, letterSpacing: -2, marginBottom: 4 },
  wordCount: { color: LUCY_COLORS.textMuted, fontSize: 14, marginBottom: 32 },
  stopBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: LUCY_COLORS.surfaceRaised,
    borderWidth: 1,
    borderColor: '#ef4444',
    borderRadius: 14,
    paddingVertical: 16,
  },
  stopIcon: { width: 16, height: 16, borderRadius: 3, backgroundColor: '#ef4444' },
  stopBtnText: { color: '#ef4444', fontSize: 16, fontWeight: '700' },
  // Processing
  processingWrap: { alignItems: 'center', padding: 20 },
  processingTitle: { color: LUCY_COLORS.textDark, fontSize: 20, fontWeight: '800', marginBottom: 8 },
  processingSub: { color: LUCY_COLORS.textMuted, fontSize: 14 },
  // Summary
  durationSmall: { color: LUCY_COLORS.textSubtle, fontSize: 13, marginBottom: 16 },
  summaryScroll: { maxHeight: 380, marginBottom: 16 },
  headline: { color: LUCY_COLORS.textDark, fontSize: 16, fontWeight: '700', lineHeight: 24, marginBottom: 16, fontStyle: 'italic' },
  sectionLabel: { color: LUCY_COLORS.primary, fontSize: 11, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 8, marginTop: 16 },
  summaryItem: { flexDirection: 'row', gap: 10, marginBottom: 8, alignItems: 'flex-start' },
  summaryBullet: { width: 6, height: 6, borderRadius: 3, backgroundColor: LUCY_COLORS.primary, marginTop: 6, flexShrink: 0 },
  summaryItemText: { color: LUCY_COLORS.textDark, fontSize: 14, lineHeight: 21, flex: 1 },
  actionItem: { flexDirection: 'row', gap: 10, marginBottom: 8, alignItems: 'flex-start' },
  actionDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: LUCY_COLORS.primaryGlow, marginTop: 6, flexShrink: 0 },
  actionText: { color: LUCY_COLORS.textDark, fontSize: 14, lineHeight: 21, flex: 1 },
  actionOwner: { color: LUCY_COLORS.primaryGlow, fontWeight: '700' },
  actionDeadline: { color: LUCY_COLORS.textSubtle },
  nextStepsText: { color: LUCY_COLORS.textDark, fontSize: 14, lineHeight: 22 },
  attendees: { color: LUCY_COLORS.textSubtle, fontSize: 12, marginTop: 16 },
  noSummary: { color: LUCY_COLORS.textMuted, fontSize: 14, lineHeight: 22 },
  dismissBtn: { alignItems: 'center', paddingVertical: 10 },
  dismissText: { color: LUCY_COLORS.textSubtle, fontSize: 14 },
});
