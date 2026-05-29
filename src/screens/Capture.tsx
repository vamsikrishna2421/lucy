import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Alert,
} from 'react-native';
import { RecordingPresets, setAudioModeAsync } from 'expo-audio';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { AudioRecorder: AR } = require('expo-audio') as { AudioRecorder: new (opts: unknown) => { prepareToRecordAsync(): Promise<void>; record(): void; stop(): Promise<void>; uri: string | null; release?: () => void } };
import { LUCY_COLORS } from '../config/colors';
import { getDatabase } from '../db';
import { listPendingTodos, archiveTodo, type TodoRow } from '../db/todos';
import { enqueueTranscript } from '../processing/extract';
import { transcribeAudioFile } from '../audio/WhisperTranscriber';
import { getRemoteAccessState } from '../ai/remoteAccess';

// On-device STT for the voice button (iOS: SFSpeechRecognizer)
let Voice: { default: { onSpeechResults: ((e: { value?: string[] }) => void) | null; onSpeechEnd: ((e: unknown) => void) | null; onSpeechError: ((e: unknown) => void) | null; start(l: string): Promise<void>; stop(): Promise<void>; destroy(): Promise<void> } } | null = null;
try { Voice = require('@react-native-voice/voice') as typeof Voice; } catch { /* not compiled yet */ }

interface DoneEntry {
  todo: TodoRow;
  doneAt: string;
  notes: string;
}

function groupTodos(todos: TodoRow[]): Array<{ label: string; items: TodoRow[] }> {
  const map = new Map<string, TodoRow[]>();
  for (const todo of todos) {
    const key = todo.context?.trim() || (todo.urgency === 'high' ? 'Urgent' : 'Pending');
    const existing = map.get(key) ?? [];
    existing.push(todo);
    map.set(key, existing);
  }
  const sorted = [...map.entries()].sort(([a], [b]) => {
    if (a === 'Urgent') return -1;
    if (b === 'Urgent') return 1;
    return a.localeCompare(b);
  });
  return sorted.map(([label, items]) => ({ label, items }));
}

function formatDoneTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

function AnimatedTodoRow({ todo, onPress }: { todo: TodoRow; onPress: () => void }) {
  const checkScale = useRef(new Animated.Value(1)).current;
  const checkFill = useRef(new Animated.Value(0)).current;
  const strikeWidth = useRef(new Animated.Value(0)).current;
  const rowOpacity = useRef(new Animated.Value(1)).current;

  const handlePress = () => {
    Animated.sequence([
      Animated.timing(checkScale, { toValue: 1.35, duration: 100, useNativeDriver: true }),
      Animated.timing(checkScale, { toValue: 1, duration: 100, useNativeDriver: true }),
    ]).start();
    Animated.timing(checkFill, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    Animated.timing(strikeWidth, { toValue: 1, duration: 380, delay: 80, useNativeDriver: false }).start();
    Animated.timing(rowOpacity, { toValue: 0, duration: 280, delay: 520, useNativeDriver: true }).start(() => {
      onPress();
    });
  };

  return (
    <Animated.View style={[styles.todoRow, { opacity: rowOpacity }]}>
      <TouchableOpacity style={styles.checkboxArea} onPress={handlePress}>
        <Animated.View style={[styles.checkCircle, { transform: [{ scale: checkScale }] }]}>
          <Animated.Text style={[styles.checkFillText, { opacity: checkFill }]}>✓</Animated.Text>
        </Animated.View>
      </TouchableOpacity>
      <View style={styles.todoContent}>
        <View style={styles.todoTextWrap}>
          <Text style={styles.todoText}>{todo.task}</Text>
          <Animated.View
            style={[
              styles.strikeBar,
              {
                width: strikeWidth.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['0%', '100%'],
                }),
              },
            ]}
          />
        </View>
        {todo.urgency === 'high' ? <Text style={styles.urgentBadge}>urgent</Text> : null}
      </View>
    </Animated.View>
  );
}

export function CaptureScreen({ refreshToken, onQueued }: { refreshToken: number; onQueued: () => void }) {
  const [text, setText] = useState('');
  const [todos, setTodos] = useState<TodoRow[]>([]);
  const [done, setDone] = useState<DoneEntry[]>([]);
  const [sending, setSending] = useState(false);
  const [acknowledgement, setAcknowledgement] = useState('');
  const [markedPrivate, setMarkedPrivate] = useState(false);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const [pendingTodo, setPendingTodo] = useState<TodoRow | null>(null);
  const [doneNotes, setDoneNotes] = useState('');
  const [voiceRecording, setVoiceRecording] = useState(false);
  type RecInst = { prepareToRecordAsync(): Promise<void>; record(): void; stop(): Promise<void>; uri: string | null; release?: () => void };
  const audioRecorder = useRef<RecInst | null>(null);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, (e) => setKeyboardOffset(e.endCoordinates.height));
    const hide = Keyboard.addListener(hideEvent, () => setKeyboardOffset(0));
    return () => { show.remove(); hide.remove(); };
  }, []);

  useEffect(() => {
    void (async () => {
      const db = await getDatabase();
      setTodos(await listPendingTodos(db));
    })();
  }, [refreshToken]);

  const openDoneModal = (todo: TodoRow) => {
    setDoneNotes('');
    setPendingTodo(todo);
  };

  const confirmDone = async (skip = false) => {
    if (!pendingTodo) return;
    const notes = skip ? '' : doneNotes.trim();
    const doneAt = new Date().toISOString();
    const db = await getDatabase();
    await archiveTodo(db, pendingTodo.id, notes ? `done: ${notes}` : 'done');
    setTodos((prev) => prev.filter((t) => t.id !== pendingTodo.id));
    setDone((prev) => [{ todo: pendingTodo, doneAt, notes }, ...prev]);
    setPendingTodo(null);
    setDoneNotes('');
    if (notes) {
      await enqueueTranscript(`Completed: ${pendingTodo.task}. ${notes}`, 'text', false);
      onQueued();
    }
  };

  const undoDone = async (entry: DoneEntry) => {
    // Put the task back in todos list (re-insert visually; DB is archived but UX restores it)
    setDone((prev) => prev.filter((e) => e.todo.id !== entry.todo.id));
    setTodos((prev) => [entry.todo, ...prev]);
  };

  const toggleVoiceInput = async () => {
    if (voiceRecording) {
      // Stop recording
      setVoiceRecording(false);
      if (Voice?.default) {
        // On-device STT: stop and get result via onSpeechResults
        await Voice.default.stop().catch(() => {});
        await Voice.default.destroy().catch(() => {});
      } else if (audioRecorder.current) {
        // Whisper fallback: stop and transcribe
        await audioRecorder.current.stop();
        const uri = audioRecorder.current.uri;
        audioRecorder.current.release?.();
        audioRecorder.current = null;
        if (uri) {
          const transcript = await transcribeAudioFile(uri);
          if (transcript) setText((prev) => prev ? `${prev} ${transcript}` : transcript);
          else Alert.alert('Could not transcribe', 'Enable Remote Intelligence in Settings for voice transcription.');
        }
      }
      return;
    }

    // Start recording
    if (Voice?.default) {
      // On-device STT (iOS SFSpeechRecognizer)
      Voice.default.onSpeechResults = (e) => {
        const text = (e.value ?? []).join(' ').trim();
        if (text) setText((prev) => prev ? `${prev} ${text}` : text);
      };
      Voice.default.onSpeechEnd = () => setVoiceRecording(false);
      Voice.default.onSpeechError = () => setVoiceRecording(false);
      await Voice.default.start('en-US');
      setVoiceRecording(true);
    } else {
      // Audio recording fallback → Whisper on stop
      try {
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        audioRecorder.current = new AR(RecordingPresets.HIGH_QUALITY);
        await audioRecorder.current.prepareToRecordAsync();
        audioRecorder.current.record();
        setVoiceRecording(true);
      } catch {
        Alert.alert('Microphone unavailable', 'Could not start recording.');
      }
    }
  };

  const sendCapture = async () => {
    const outgoing = text.trim();
    if (!outgoing) return;
    try {
      setSending(true);
      await enqueueTranscript(outgoing, 'text', markedPrivate);
      setText('');
      setAcknowledgement(markedPrivate ? 'Protected thought queued' : 'Got it');
      setMarkedPrivate(false);
      setTimeout(() => setAcknowledgement(''), 2000);
      onQueued();
    } catch (error) {
      Alert.alert('Could not save this', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setSending(false);
    }
  };

  const groups = groupTodos(todos);

  return (
    <View style={[styles.container, { paddingBottom: keyboardOffset }]}>
      <ScrollView style={styles.board} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {groups.length === 0 && done.length === 0 ? (
          <View style={styles.emptyBoard}>
            <Text style={styles.emptyTitle}>Your board is clear</Text>
            <Text style={styles.emptyHint}>Capture something and LUCY will organize it here by category.</Text>
          </View>
        ) : (
          <>
            {groups.map((group) => (
              <View key={group.label} style={styles.group}>
                <Text style={styles.groupLabel}>{group.label.toUpperCase()}</Text>
                {group.items.map((todo) => (
                  <AnimatedTodoRow key={todo.id} todo={todo} onPress={() => openDoneModal(todo)} />
                ))}
              </View>
            ))}

            {done.length > 0 ? (
              <View style={styles.doneSection}>
                <View style={styles.doneDivider}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerLabel}>Done today</Text>
                  <View style={styles.dividerLine} />
                </View>
                {done.map((entry, i) => (
                  <View key={i} style={styles.doneRow}>
                    <View style={styles.doneCheck}>
                      <Text style={styles.doneCheckMark}>✓</Text>
                    </View>
                    <View style={styles.doneContent}>
                      <Text style={styles.doneText}>{entry.todo.task}</Text>
                      {entry.notes ? <Text style={styles.doneNotes}>{entry.notes}</Text> : null}
                      <Text style={styles.doneTime}>{formatDoneTime(entry.doneAt)}</Text>
                    </View>
                    <TouchableOpacity style={styles.undoButton} onPress={() => void undoDone(entry)}>
                      <Text style={styles.undoText}>undo</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            ) : null}
          </>
        )}
        <View style={{ height: 12 }} />
      </ScrollView>

      {acknowledgement ? (
        <View style={styles.ack}>
          <Text style={styles.ackText}>{acknowledgement}</Text>
        </View>
      ) : null}

      <View style={styles.composerDock}>
        <View style={styles.composer}>
          <TouchableOpacity
            style={[styles.micButton, voiceRecording && styles.micButtonActive]}
            onPress={() => void toggleVoiceInput()}
          >
            <Text style={[styles.micIcon, voiceRecording && styles.micIconActive]}>
              {voiceRecording ? '■' : '♪'}
            </Text>
          </TouchableOpacity>
          <TextInput
            multiline
            placeholder="Capture anything..."
            placeholderTextColor={LUCY_COLORS.textSubtle}
            style={styles.input}
            textAlignVertical="top"
            value={text}
            onChangeText={setText}
          />
          <TouchableOpacity
            style={[styles.sendButton, !text.trim() && styles.sendDisabled]}
            onPress={() => void sendCapture()}
            disabled={sending || !text.trim()}
          >
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
            {markedPrivate ? <Text style={styles.checkMark}>{'✓'}</Text> : null}
          </View>
          <View style={styles.protectionText}>
            <Text style={styles.protectionTitle}>Contains private details</Text>
            <Text style={styles.protectionHint}>Mask locally before remote intelligence</Text>
          </View>
        </TouchableOpacity>
      </View>

      <Modal
        transparent
        animationType="fade"
        visible={pendingTodo !== null}
        onRequestClose={() => setPendingTodo(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setPendingTodo(null)}>
          <Pressable style={styles.modalCard}>
            <Text style={styles.modalTitle}>Mark as done</Text>
            <Text style={styles.modalTask}>{pendingTodo?.task}</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Add a note (optional)"
              placeholderTextColor={LUCY_COLORS.textSubtle}
              value={doneNotes}
              onChangeText={setDoneNotes}
              multiline
              autoFocus
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.modalSkip} onPress={() => void confirmDone(true)}>
                <Text style={styles.modalSkipText}>Skip</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalDone} onPress={() => void confirmDone(false)}>
                <Text style={styles.modalDoneText}>Done</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  board: { flex: 1 },
  emptyBoard: { paddingTop: 40, alignItems: 'center', gap: 10 },
  emptyTitle: { color: LUCY_COLORS.textMuted, fontSize: 18, fontWeight: '700' },
  emptyHint: { color: LUCY_COLORS.textSubtle, fontSize: 14, textAlign: 'center', lineHeight: 20, paddingHorizontal: 20 },
  group: { marginBottom: 22 },
  groupLabel: {
    color: LUCY_COLORS.primaryGlow,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  todoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: LUCY_COLORS.surfaceRaised,
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: LUCY_COLORS.border,
  },
  checkboxArea: { paddingTop: 1 },
  checkCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: LUCY_COLORS.textSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkFillText: { color: LUCY_COLORS.success, fontSize: 12, fontWeight: '800' },
  todoContent: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  todoTextWrap: { flex: 1, position: 'relative', justifyContent: 'center' },
  todoText: { color: LUCY_COLORS.textDark, fontSize: 15, lineHeight: 22 },
  strikeBar: {
    position: 'absolute',
    height: 1.5,
    backgroundColor: LUCY_COLORS.textMuted,
    top: '50%',
    left: 0,
  },
  urgentBadge: {
    color: LUCY_COLORS.primary,
    fontSize: 10,
    fontWeight: '800',
    backgroundColor: LUCY_COLORS.primarySoft,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    letterSpacing: 0.3,
  },
  // Done section
  doneSection: { marginTop: 8 },
  doneDivider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  dividerLine: { flex: 1, height: 1, backgroundColor: LUCY_COLORS.divider },
  dividerLabel: { color: LUCY_COLORS.textSubtle, fontSize: 10, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase' },
  doneRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: LUCY_COLORS.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: LUCY_COLORS.divider,
    opacity: 0.6,
  },
  doneCheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: LUCY_COLORS.success + '22',
    borderWidth: 1,
    borderColor: LUCY_COLORS.success + '55',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  doneCheckMark: { color: LUCY_COLORS.success, fontSize: 11, fontWeight: '800' },
  doneContent: { flex: 1, gap: 2 },
  doneText: { color: LUCY_COLORS.textSubtle, fontSize: 14, lineHeight: 20, textDecorationLine: 'line-through' },
  doneNotes: { color: LUCY_COLORS.textSubtle, fontSize: 12, lineHeight: 18, fontStyle: 'italic', marginTop: 2 },
  doneTime: { color: LUCY_COLORS.textSubtle, fontSize: 11, marginTop: 3 },
  undoButton: { paddingVertical: 4, paddingHorizontal: 6 },
  undoText: { color: LUCY_COLORS.primaryGlow, fontSize: 11, fontWeight: '700' },
  // Capture
  ack: { alignSelf: 'center', backgroundColor: LUCY_COLORS.primarySoft, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, marginBottom: 8 },
  ackText: { color: LUCY_COLORS.primaryGlow, fontSize: 12, fontWeight: '700' },
  composerDock: {},
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 9, paddingTop: 8 },
  micButton: { width: 46, height: 46, borderRadius: 23, backgroundColor: LUCY_COLORS.surfaceRaised, borderWidth: 1, borderColor: LUCY_COLORS.border, alignItems: 'center', justifyContent: 'center' },
  micButtonActive: { backgroundColor: '#3B0000', borderColor: '#ef4444' },
  micIcon: { fontSize: 18, color: LUCY_COLORS.textMuted },
  micIconActive: { color: '#ef4444' },
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
  protectionToggle: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 10, paddingHorizontal: 4 },
  check: { width: 19, height: 19, borderRadius: 6, borderWidth: 1, borderColor: LUCY_COLORS.textMuted, alignItems: 'center', justifyContent: 'center' },
  checkSelected: { backgroundColor: LUCY_COLORS.primary, borderColor: LUCY_COLORS.primary },
  checkMark: { color: LUCY_COLORS.white, fontSize: 13, fontWeight: '700' },
  protectionText: { flex: 1 },
  protectionTitle: { color: LUCY_COLORS.textDark, fontSize: 13, fontWeight: '600' },
  protectionHint: { color: LUCY_COLORS.textMuted, fontSize: 11, marginTop: 1 },
  // Modal
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalCard: { backgroundColor: LUCY_COLORS.surface, borderRadius: 20, padding: 24, width: '100%', maxWidth: 380, borderWidth: 1, borderColor: LUCY_COLORS.border, gap: 14 },
  modalTitle: { color: LUCY_COLORS.primaryGlow, fontSize: 12, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase' },
  modalTask: { color: LUCY_COLORS.textDark, fontSize: 16, fontWeight: '700', lineHeight: 23 },
  modalInput: { backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 12, borderWidth: 1, borderColor: LUCY_COLORS.border, padding: 12, color: LUCY_COLORS.textDark, fontSize: 15, minHeight: 72, textAlignVertical: 'top' },
  modalButtons: { flexDirection: 'row', gap: 10 },
  modalSkip: { flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 1, borderColor: LUCY_COLORS.border, alignItems: 'center' },
  modalSkipText: { color: LUCY_COLORS.textMuted, fontSize: 15, fontWeight: '600' },
  modalDone: { flex: 2, paddingVertical: 13, borderRadius: 12, backgroundColor: LUCY_COLORS.primary, alignItems: 'center' },
  modalDoneText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
