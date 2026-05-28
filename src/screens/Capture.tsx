import { useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { PrivacyBadge } from '../components/PrivacyBadge';
import { LUCY_COLORS } from '../config/colors';
import { getDatabase } from '../db';
import { captureStatus, listCaptureUpdates, listRecentCaptures, type CaptureRow } from '../db/captures';
import { enqueueTranscript } from '../processing/extract';
import { protectedPreview } from '../processing/privacy';

function displayTimestamp(value: string): string {
  return new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`).toLocaleString();
}

function groupUpdates(updates: CaptureRow[]): Record<number, CaptureRow[]> {
  return updates.reduce<Record<number, CaptureRow[]>>((grouped, update) => {
    if (update.parent_capture_id === null) {
      return grouped;
    }
    const existing = grouped[update.parent_capture_id] ?? [];
    grouped[update.parent_capture_id] = [...existing, update];
    return grouped;
  }, {});
}

export function CaptureScreen({ refreshToken, onQueued }: { refreshToken: number; onQueued: () => void }) {
  const [text, setText] = useState('');
  const [captures, setCaptures] = useState<CaptureRow[]>([]);
  const [updates, setUpdates] = useState<Record<number, CaptureRow[]>>({});
  const [sending, setSending] = useState(false);
  const [acknowledgement, setAcknowledgement] = useState('');
  const [markedPrivate, setMarkedPrivate] = useState(false);

  useEffect(() => {
    void (async () => {
      const db = await getDatabase();
      const nextCaptures = await listRecentCaptures(db);
      const nextUpdates = await listCaptureUpdates(db, nextCaptures.map((capture) => capture.id));
      setCaptures(nextCaptures);
      setUpdates(groupUpdates(nextUpdates));
    })();
  }, [refreshToken]);

  async function sendCapture() {
    const outgoing = text.trim();
    if (!outgoing) {
      return;
    }
    try {
      setSending(true);
      await enqueueTranscript(outgoing, 'text', markedPrivate);
      setText('');
      setAcknowledgement(markedPrivate ? 'Protected thought queued' : 'Remembered securely');
      setMarkedPrivate(false);
      onQueued();
    } catch (error) {
      Alert.alert('Could not remember this thought', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setSending(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.heading}>
        <Text style={styles.title}>Inbox</Text>
        <Text style={styles.intro}>Drop a thought. Keep moving. We organize quietly.</Text>
      </View>
      {acknowledgement ? (
        <View style={styles.ack}>
          <Text style={styles.ackText}>{acknowledgement}</Text>
        </View>
      ) : null}
      <KeyboardAvoidingView
        style={styles.liftedContent}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <FlatList
          data={captures}
          inverted
          keyboardShouldPersistTaps="handled"
          style={styles.feedList}
          contentContainerStyle={styles.feed}
          keyExtractor={(item) => String(item.id)}
          ListEmptyComponent={<Text style={styles.empty}>Your captured thoughts will appear here.</Text>}
          renderItem={({ item }) => <CaptureBubble item={item} updates={updates[item.id] ?? []} />}
        />
        <View style={styles.composerDock}>
          <View style={styles.composer}>
            <TouchableOpacity
              style={styles.micButton}
              onPress={() => Alert.alert('Coming soon', 'Voice recording is coming soon. Dictate with WhisperFlow today.')}
            >
              <Text style={styles.micText}>+</Text>
            </TouchableOpacity>
            <TextInput
              multiline
              placeholder="Capture anything..."
              placeholderTextColor="#8a968f"
              style={styles.input}
              textAlignVertical="top"
              value={text}
              onChangeText={setText}
            />
            <TouchableOpacity style={[styles.sendButton, !text.trim() && styles.sendDisabled]} onPress={sendCapture} disabled={sending || !text.trim()}>
              <Text style={styles.sendText}>{sending ? '...' : 'Send'}</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            accessibilityRole="checkbox"
            accessibilityState={{ checked: markedPrivate }}
            style={styles.protectionToggle}
            onPress={() => setMarkedPrivate((current) => !current)}
          >
            <View style={[styles.check, markedPrivate && styles.checkSelected]}>
              {markedPrivate ? <Text style={styles.checkMark}>{'\u2713'}</Text> : null}
            </View>
            <View style={styles.protectionText}>
              <Text style={styles.protectionTitle}>Contains private details</Text>
              <Text style={styles.protectionHint}>Mask locally before remote intelligence</Text>
            </View>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function CaptureBubble({ item, updates }: { item: CaptureRow; updates: CaptureRow[] }) {
  const status = captureStatus(item);
  const statusLabel = {
    queued: 'Queued',
    processing: 'Organizing',
    complete: 'Remembered',
    retrying: 'Will retry',
    archived: 'Archived',
  }[status];
  return (
    <View style={styles.bubble}>
      <Text style={styles.message}>{protectedPreview(item.raw_transcript)}</Text>
      {item.extracted_title ? <Text style={styles.organizedAs}>{item.extracted_title}</Text> : null}
      {item.guardian_note ? (
        <View style={styles.guardianCard}>
          <Text style={styles.guardianLabel}>LUCY remembered</Text>
          <Text style={styles.guardianText}>{item.guardian_note}</Text>
        </View>
      ) : null}
      <Text style={styles.capturedAt}>Captured {displayTimestamp(item.created_at)}</Text>
      {updates.length ? (
        <View style={styles.timeline}>
          {updates.map((update) => (
            <View key={update.id} style={styles.update}>
              <Text style={styles.updateText}>{protectedPreview(update.raw_transcript)}</Text>
              <Text style={styles.updateTime}>Completed {displayTimestamp(update.created_at)}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <View style={styles.meta}>
        <PrivacyBadge level={item.privacy_level} />
        <Text style={[styles.status, styles[`status_${status}`]]}>{statusLabel}</Text>
      </View>
      {status === 'retrying' && item.processing_error ? <Text style={styles.failure}>LUCY will organize this automatically when processing is available.</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  liftedContent: { flex: 1 },
  heading: { marginBottom: 10 },
  title: { fontSize: 30, letterSpacing: -0.8, fontWeight: '700', color: LUCY_COLORS.textDark },
  intro: { color: LUCY_COLORS.textMuted, fontSize: 14, marginTop: 4 },
  ack: { alignSelf: 'center', backgroundColor: LUCY_COLORS.primarySoft, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, marginVertical: 8 },
  ackText: { color: LUCY_COLORS.primaryGlow, fontSize: 12, fontWeight: '700' },
  feedList: { flex: 1 },
  feed: { flexGrow: 1, justifyContent: 'flex-end', paddingVertical: 10 },
  empty: { color: LUCY_COLORS.textMuted, textAlign: 'center', marginVertical: 40 },
  bubble: {
    alignSelf: 'flex-end',
    width: '92%',
    backgroundColor: LUCY_COLORS.surfaceRaised,
    borderRadius: 20,
    borderBottomRightRadius: 6,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: LUCY_COLORS.border,
    shadowColor: LUCY_COLORS.primary,
    shadowOpacity: 0.09,
    shadowRadius: 10,
    elevation: 1,
  },
  message: { color: LUCY_COLORS.textDark, fontSize: 15, lineHeight: 21 },
  organizedAs: { color: LUCY_COLORS.textMuted, marginTop: 8, fontSize: 13, fontWeight: '600' },
  capturedAt: { color: LUCY_COLORS.textMuted, fontSize: 12, marginTop: 7 },
  timeline: { borderLeftWidth: 2, borderLeftColor: LUCY_COLORS.primary, paddingLeft: 12, marginTop: 12 },
  update: { paddingVertical: 4 },
  updateText: { color: LUCY_COLORS.textDark, fontSize: 14, fontWeight: '600' },
  updateTime: { color: LUCY_COLORS.textMuted, fontSize: 12, marginTop: 3 },
  meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginTop: 10 },
  status: { fontSize: 12, fontWeight: '700' },
  status_queued: { color: LUCY_COLORS.textMuted },
  status_processing: { color: LUCY_COLORS.primaryGlow },
  status_complete: { color: LUCY_COLORS.success },
  status_retrying: { color: LUCY_COLORS.warning },
  status_archived: { color: LUCY_COLORS.textSubtle },
  failure: { color: '#FDA4AF', fontSize: 12, marginTop: 6 },
  guardianCard: { backgroundColor: LUCY_COLORS.primarySoft, borderRadius: 12, padding: 10, marginTop: 10 },
  guardianLabel: { color: LUCY_COLORS.primaryGlow, fontSize: 11, fontWeight: '700', letterSpacing: 0.4, marginBottom: 4 },
  guardianText: { color: LUCY_COLORS.textDark, fontSize: 13, lineHeight: 18 },
  composerDock: {},
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 9, paddingTop: 8 },
  micButton: { width: 45, height: 45, borderRadius: 23, backgroundColor: LUCY_COLORS.surfaceRaised, borderWidth: 1, borderColor: LUCY_COLORS.border, alignItems: 'center', justifyContent: 'center' },
  micText: { color: LUCY_COLORS.primaryGlow, fontWeight: '500', fontSize: 25 },
  input: {
    flex: 1,
    maxHeight: 110,
    minHeight: 48,
    borderRadius: 24,
    backgroundColor: LUCY_COLORS.surfaceRaised,
    borderWidth: 1,
    borderColor: LUCY_COLORS.border,
    color: LUCY_COLORS.textDark,
    fontSize: 16,
    lineHeight: 22,
    paddingHorizontal: 16,
    paddingTop: 13,
    paddingBottom: 12,
  },
  sendButton: { height: 46, paddingHorizontal: 17, borderRadius: 23, backgroundColor: LUCY_COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  sendDisabled: { backgroundColor: '#3A3531' },
  sendText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  protectionToggle: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 10, paddingHorizontal: 54 },
  check: { width: 19, height: 19, borderRadius: 6, borderWidth: 1, borderColor: LUCY_COLORS.textMuted, alignItems: 'center', justifyContent: 'center' },
  checkSelected: { backgroundColor: LUCY_COLORS.primary, borderColor: LUCY_COLORS.primary },
  checkMark: { color: LUCY_COLORS.white, fontSize: 13, fontWeight: '700' },
  protectionText: { flex: 1 },
  protectionTitle: { color: LUCY_COLORS.textDark, fontSize: 13, fontWeight: '600' },
  protectionHint: { color: LUCY_COLORS.textMuted, fontSize: 11, marginTop: 1 },
});
