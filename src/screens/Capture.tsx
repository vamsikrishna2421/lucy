import { useEffect, useState } from 'react';
import {
  Alert,
  Keyboard,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { PrivacyBadge } from '../components/PrivacyBadge';
import { LUCY_COLORS } from '../config/colors';
import { getDatabase } from '../db';
import { listPendingTodos, archiveTodo, type TodoRow } from '../db/todos';
import { enqueueTranscript } from '../processing/extract';

function groupTodos(todos: TodoRow[]): Array<{ label: string; items: TodoRow[] }> {
  const map = new Map<string, TodoRow[]>();
  for (const todo of todos) {
    const key = todo.context?.trim() || (todo.urgency === 'high' ? 'Urgent' : 'Pending');
    const existing = map.get(key) ?? [];
    existing.push(todo);
    map.set(key, existing);
  }
  // Sort: Urgent first, then alphabetical
  const sorted = [...map.entries()].sort(([a], [b]) => {
    if (a === 'Urgent') return -1;
    if (b === 'Urgent') return 1;
    return a.localeCompare(b);
  });
  return sorted.map(([label, items]) => ({ label, items }));
}

export function CaptureScreen({ refreshToken, onQueued }: { refreshToken: number; onQueued: () => void }) {
  const [text, setText] = useState('');
  const [todos, setTodos] = useState<TodoRow[]>([]);
  const [sending, setSending] = useState(false);
  const [acknowledgement, setAcknowledgement] = useState('');
  const [markedPrivate, setMarkedPrivate] = useState(false);
  const [keyboardOffset, setKeyboardOffset] = useState(0);

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

  const markDone = async (todo: TodoRow) => {
    const db = await getDatabase();
    await archiveTodo(db, todo.id, 'done');
    setTodos((prev) => prev.filter((t) => t.id !== todo.id));
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
        {groups.length === 0 ? (
          <View style={styles.emptyBoard}>
            <Text style={styles.emptyTitle}>Your board is clear</Text>
            <Text style={styles.emptyHint}>Capture something and LUCY will organize it here by category.</Text>
          </View>
        ) : (
          groups.map((group) => (
            <View key={group.label} style={styles.group}>
              <Text style={styles.groupLabel}>{group.label.toUpperCase()}</Text>
              {group.items.map((todo) => (
                <View key={todo.id} style={styles.todoRow}>
                  <TouchableOpacity style={styles.checkbox} onPress={() => void markDone(todo)}>
                    <View style={styles.checkCircle} />
                  </TouchableOpacity>
                  <View style={styles.todoContent}>
                    <Text style={styles.todoText}>{todo.task}</Text>
                    {todo.urgency === 'high' ? <Text style={styles.urgentBadge}>urgent</Text> : null}
                  </View>
                </View>
              ))}
            </View>
          ))
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  board: { flex: 1 },
  emptyBoard: { paddingTop: 40, alignItems: 'center', gap: 10 },
  emptyTitle: { color: LUCY_COLORS.textMuted, fontSize: 18, fontWeight: '700' },
  emptyHint: { color: LUCY_COLORS.textSubtle, fontSize: 14, textAlign: 'center', lineHeight: 20, paddingHorizontal: 20 },
  group: { marginBottom: 20 },
  groupLabel: {
    color: LUCY_COLORS.primaryGlow,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 8,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: LUCY_COLORS.divider,
  },
  todoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 8 },
  checkbox: { paddingTop: 2 },
  checkCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: LUCY_COLORS.textSubtle,
  },
  todoContent: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  todoText: { color: LUCY_COLORS.textDark, fontSize: 15, lineHeight: 22, flex: 1 },
  urgentBadge: {
    color: LUCY_COLORS.primary,
    fontSize: 11,
    fontWeight: '700',
    backgroundColor: LUCY_COLORS.primarySoft,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  ack: {
    alignSelf: 'center',
    backgroundColor: LUCY_COLORS.primarySoft,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    marginBottom: 8,
  },
  ackText: { color: LUCY_COLORS.primaryGlow, fontSize: 12, fontWeight: '700' },
  composerDock: {},
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 9, paddingTop: 8 },
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
});
