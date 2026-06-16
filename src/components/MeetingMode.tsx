import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { captureRef } from 'react-native-view-shot';
import { LUCY_COLORS } from '../config/colors';
import { passiveListener } from '../audio/PassiveListener';
import { generateMeetingSummary, saveMeetingToMemory, saveRawTranscriptAsMeeting, type MeetingSummary } from '../processing/meetingMode';
import { getDatabase } from '../db';

/** Formats a meeting summary as nicely structured plain text for clipboard / text share. */
function formatSummaryText(summary: MeetingSummary | null, title: string, durationLabel: string): string {
  if (!summary) return `${title}\n${durationLabel}`;
  const lines: string[] = [];
  lines.push(`📋 ${title}`);
  lines.push(`🕐 ${durationLabel}`);
  lines.push('');
  if (summary.headline) { lines.push(summary.headline); lines.push(''); }
  if (summary.keyDecisions.length > 0) {
    lines.push('✅ Decisions');
    summary.keyDecisions.forEach((d) => lines.push(`  • ${d}`));
    lines.push('');
  }
  if (summary.actionItems.length > 0) {
    lines.push('📌 Action Items');
    summary.actionItems.forEach((a) => {
      const owner = a.owner ? ` → ${a.owner}` : '';
      const deadline = a.deadline ? ` · ${a.deadline}` : '';
      lines.push(`  • ${a.task}${owner}${deadline}`);
    });
    lines.push('');
  }
  if (summary.openQuestions.length > 0) {
    lines.push('❓ Open Questions');
    summary.openQuestions.forEach((q) => lines.push(`  • ${q}`));
    lines.push('');
  }
  if (summary.nextSteps) { lines.push('➡️ Next Steps'); lines.push(`  ${summary.nextSteps}`); lines.push(''); }
  if (summary.attendeesMentioned.length > 0) lines.push(`👥 Mentioned: ${summary.attendeesMentioned.join(', ')}`);
  lines.push('');
  lines.push('— Summarized by LUCY');
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

type MeetingPhase = 'idle' | 'naming' | 'recording' | 'processing' | 'summary';

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export function MeetingMode({ visible, onClose, onRecordingStarted, onSummaryReady, onDone }: {
  visible: boolean;
  onClose: () => void;
  /** Called when the mic starts — parent can hide the modal so the app is freely usable. */
  onRecordingStarted?: () => void;
  /** Called when the summary is ready — parent should make the modal visible so user sees it. */
  onSummaryReady?: () => void;
  /** Called when the meeting fully ends (summary dismissed or meeting cancelled). */
  onDone?: () => void;
}) {
  const [phase, setPhase] = useState<MeetingPhase>('idle');
  const [meetingTitle, setMeetingTitle] = useState('');
  const [startedAt, setStartedAt] = useState<Date | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [summary, setSummary] = useState<MeetingSummary | null>(null);
  const [savedToMemory, setSavedToMemory] = useState(false);

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const timerRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  // Guards against saving the same meeting twice (auto-save + explicit "Save to memory").
  const savedRef  = useRef(false);
  // Raw transcript captured at stop time, used for the fallback save path.
  const rawTranscriptRef = useRef('');
  // Ref to the summary card view for capturing it as an image.
  const cardRef = useRef<View>(null);
  const [sharing, setSharing] = useState(false);

  const durationLabel = () => `Duration: ${formatDuration(elapsed)}`;

  const copySummaryText = async () => {
    try {
      await Clipboard.setStringAsync(formatSummaryText(summary, meetingTitle || 'Meeting', durationLabel()));
      Alert.alert('Copied', 'Meeting summary copied to clipboard. Paste it into WhatsApp, Notes, or anywhere.');
    } catch { Alert.alert('Copy failed', 'Could not copy to clipboard.'); }
  };

  const shareSummaryText = async () => {
    try {
      await Share.share({ message: formatSummaryText(summary, meetingTitle || 'Meeting', durationLabel()) });
    } catch { /* user cancelled */ }
  };

  const captureCardImage = async (): Promise<string> => {
    if (!cardRef.current) throw new Error('card not ready');
    // Two attempts: tmpfile first; some iOS versions need a small settle delay.
    try {
      return await captureRef(cardRef, { format: 'png', quality: 1, result: 'tmpfile' });
    } catch {
      await new Promise((r) => setTimeout(r, 250));
      return await captureRef(cardRef, { format: 'png', quality: 0.9, result: 'tmpfile' });
    }
  };

  const shareCardImage = async () => {
    setSharing(true);
    try {
      const uri = await captureCardImage();
      const Sharing = await import('expo-sharing');
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Share meeting summary' });
      } else {
        Alert.alert('Sharing unavailable', 'Image sharing is not available on this device.');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert('Could not create image', msg);
    } finally { setSharing(false); }
  };

  const saveCardToGallery = async () => {
    setSharing(true);
    try {
      const MediaLibrary = await import('expo-media-library/legacy');
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Photos permission needed', 'Allow photo library access in Settings → LUCY to save summary cards.');
        return;
      }
      const uri = await captureCardImage();
      await MediaLibrary.saveToLibraryAsync(uri);
      Alert.alert('Saved', 'Meeting summary card saved to your photos.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert('Save failed', msg);
    } finally { setSharing(false); }
  };

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
    savedRef.current = false;
    rawTranscriptRef.current = '';
    setSavedToMemory(false);
    setPhase('recording');
    await passiveListener.start({ meetingMode: true });
    // Let the parent hide the modal so the user can use the app freely while recording.
    onRecordingStarted?.();
  };

  /**
   * Persists the meeting exactly once. Safe to call from multiple places
   * (auto-save on stop, dismiss safety net) — the savedRef guard prevents
   * the duplicate copies that previously appeared in Brain → Meetings.
   */
  const persistMeeting = async (gen: MeetingSummary | null, durationMs: number): Promise<void> => {
    if (savedRef.current) return;
    savedRef.current = true; // set before await so a concurrent call can't slip through
    try {
      if (gen) {
        await saveMeetingToMemory(gen, meetingTitle, durationMs);
      } else if (rawTranscriptRef.current.trim().length > 0) {
        await saveRawTranscriptAsMeeting(rawTranscriptRef.current, meetingTitle, durationMs);
      } else {
        savedRef.current = false; // nothing to save — allow a later retry
      }
    } catch {
      savedRef.current = false; // save failed — allow a retry from the dismiss path
    }
  };

  const stopMeeting = async () => {
    setPhase('processing');
    // Make sure the modal is visible so the user sees "Summarizing…" — call before the async work.
    onSummaryReady?.();
    // Grab the accumulated transcript BEFORE stopping (stop flushes the buffer)
    const rawTranscript = passiveListener.getAccumulatedTranscript();
    rawTranscriptRef.current = rawTranscript;
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
    // Ensure the modal is visible so the user sees the summary card even if they dismissed
    // the sheet during background recording. Must be called before persistMeeting so the
    // parent can show the modal before the async save completes.
    onSummaryReady?.();
    // Save automatically and exactly once — no explicit button needed.
    await persistMeeting(gen, durationMs);
    setSavedToMemory(true);
  };

  const closeMeeting = () => {
    setPhase('idle');
    setMeetingTitle('');
    setSummary(null);
    setSavedToMemory(false);
    savedRef.current = false;
    rawTranscriptRef.current = '';
    onDone?.();
    onClose();
  };

  const handleClose = () => {
    if (phase === 'recording') {
      void stopMeeting();
      return;
    }
    // Safety net: if the summary is showing but the auto-save didn't land, save before closing.
    if (phase === 'summary' && !savedRef.current) {
      const durationMs = startedAt ? Date.now() - startedAt.getTime() : 0;
      void persistMeeting(summary, durationMs).finally(closeMeeting);
      return;
    }
    closeMeeting();
  };

  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={handleClose}>
      <Pressable style={styles.backdrop} onPress={phase === 'idle' ? handleClose : undefined}>
        <Pressable style={[styles.sheet, phase === 'summary' && styles.sheetExpanded]}>

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
              <Text style={styles.processingTitle}>Summarizing your meeting…</Text>
              <Text style={styles.processingSub}>Please wait — LUCY is extracting decisions, action items, and follow-ups</Text>
            </View>
          )}

          {/* SUMMARY phase */}
          {phase === 'summary' && (
            <View style={styles.summaryPhaseWrap}>
              <ScrollView style={styles.summaryScroll} showsVerticalScrollIndicator={true}>
                {/* cardRef wraps the shareable card — title + summary + LUCY branding */}
                <View ref={cardRef} collapsable={false} style={styles.shareCard}>
                <Text style={styles.sheetTitle}>{meetingTitle || 'Meeting'}</Text>
                <Text style={styles.durationSmall}>Duration: {formatDuration(elapsed)}</Text>
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
                    No speech was captured during this meeting. Make sure the mic is active (orange dot visible) and speak near the phone.
                    The meeting has been saved to your memories.
                  </Text>
                )}
                  {/* LUCY branding inside the captured card */}
                  <Text style={styles.cardBrand}>LUC<Text style={{ color: LUCY_COLORS.primary }}>Y</Text> · meeting summary</Text>
                </View>
              </ScrollView>

              {/* Share actions */}
              {summary ? (
                <View style={styles.shareRow}>
                  <ShareAction icon="📋" label="Copy" onPress={() => void copySummaryText()} disabled={sharing} />
                  <ShareAction icon="↗" label="Share text" onPress={() => void shareSummaryText()} disabled={sharing} />
                  <ShareAction icon="🖼" label="Share card" onPress={() => void shareCardImage()} disabled={sharing} />
                  <ShareAction icon="⬇" label="Save image" onPress={() => void saveCardToGallery()} disabled={sharing} />
                </View>
              ) : null}

              <View style={styles.savedNotice}>
                <Text style={styles.savedNoticeText}>
                  {savedToMemory ? '✓ Saved to LUCY memory' : 'Saving to memory…'}
                </Text>
              </View>
              <TouchableOpacity style={styles.startBtn} onPress={handleClose}>
                <Text style={styles.startBtnText}>Done</Text>
              </TouchableOpacity>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ShareAction({ icon, label, onPress, disabled }: { icon: string; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <TouchableOpacity style={[styles.shareAction, disabled && { opacity: 0.5 }]} onPress={onPress} disabled={disabled} activeOpacity={0.7}>
      <Text style={styles.shareActionIcon}>{icon}</Text>
      <Text style={styles.shareActionLabel}>{label}</Text>
    </TouchableOpacity>
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
  sheetExpanded: { flex: 1 },
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
  savedNotice: { alignItems: 'center', paddingVertical: 10, marginBottom: 4 },
  savedNoticeText: { color: LUCY_COLORS.success, fontSize: 14, fontWeight: '700' },
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
  summaryPhaseWrap: { flex: 1 },
  durationSmall: { color: LUCY_COLORS.textSubtle, fontSize: 13, marginBottom: 16 },
  summaryScroll: { flex: 1, marginBottom: 16 },
  shareCard: { backgroundColor: LUCY_COLORS.surface, borderRadius: 16, padding: 16 },
  cardBrand: { color: LUCY_COLORS.textSubtle, fontSize: 11, fontWeight: '800', letterSpacing: 0.5, marginTop: 18, textAlign: 'right' },
  shareRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  shareAction: { flex: 1, alignItems: 'center', paddingVertical: 12, backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 12, borderWidth: 1, borderColor: LUCY_COLORS.border, gap: 4 },
  shareActionIcon: { fontSize: 18 },
  shareActionLabel: { color: LUCY_COLORS.textMuted, fontSize: 10, fontWeight: '700' },
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
