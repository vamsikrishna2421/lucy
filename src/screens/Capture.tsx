import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Keyboard,
  useWindowDimensions,
  Linking,
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
  Easing,
} from 'react-native';
import type { PassiveListenerState } from '../audio/PassiveListener';
import { haptic } from '../config/haptics';
import { RecordingPresets, setAudioModeAsync } from 'expo-audio';
import {
  ExpoSpeechRecognitionModule,
  type ExpoSpeechRecognitionErrorEvent,
  type ExpoSpeechRecognitionResultEvent,
} from 'expo-speech-recognition';
import * as ImagePicker from 'expo-image-picker';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { AudioRecorder: AR } = require('expo-audio') as { AudioRecorder: new (opts: unknown) => { prepareToRecordAsync(): Promise<void>; record(): void; stop(): Promise<void>; uri: string | null; release?: () => void } };
import { LUCY_COLORS } from '../config/colors';
import { getDatabase } from '../db';
import { listPendingTodos, archiveTodo, type TodoRow } from '../db/todos';
import { enqueueTranscript, analyzeTranscript } from '../processing/extract';
import { transcribeAudioFile } from '../audio/WhisperTranscriber';
import { getRemoteAccessState } from '../ai/remoteAccess';
import { CaptureReplay } from '../components/CaptureReplay';
import { detectAutomationIntent, executeAction, type ExtractedAction } from '../processing/automationEngine';
import type { ExtractionResult } from '../types/extraction';

interface DoneEntry {
  todo: TodoRow;
  doneAt: string;
  notes: string;
}

interface TaskCategory {
  id: string;
  label: string;
  icon: string;
  color: string;
  items: TodoRow[];
}

const CATEGORY_RULES: Array<{ id: string; label: string; icon: string; color: string; pattern: RegExp }> = [
  { id: 'grocery',  label: 'Grocery List',    icon: '🛒', color: '#4ADE80', pattern: /grocery|groceries|food|milk|vegetable|onion|tomato|garlic|spinach|mango|bread|butter|eggs|cereal|buy.*food|shopping list|produce/i },
  { id: 'habits',   label: 'Daily Habits',    icon: '✦',  color: '#60A5FA', pattern: /habit|routine|morning|evening|workout|exercise|run\b|yoga|meditation|daily|wake|sleep|stretc|vitamin|water|steps|walk\b|walking/i },
  // "work" alone is too broad (matches "work towards", "work on myself"). Require job-context neighbours.
  { id: 'work',     label: 'Work & Deadlines',icon: '⌘',  color: '#FF8C42', pattern: /\boffice\b|project deadline|work deadline|at work|for work|meeting\b|client\b|team\b|sprint\b|deploy\b|engineering\b|presentation\b|standup\b|code review|pull request|jira|slack|submit.*report|send.*report/i },
  { id: 'calls',    label: 'Calls & Messages', icon: '◉',  color: '#F472B6', pattern: /call|phone|text|sms|message|whatsapp|ping|contact|follow.up|reach out/i },
  { id: 'health',   label: 'Health',          icon: '♡',  color: '#FCA5A5', pattern: /health|doctor|dentist|medical|physio|appointment|clinic|pharmacy|medicine|pill|prescription|weight loss|lose weight|diet\b|calories|steps goal|walk more|gym\b|fitness/i },
  { id: 'personal', label: 'Personal',        icon: '◈',  color: '#A78BFA', pattern: /family|home|personal|mom|dad|kids|children|house|clean|laundry|bills|bank/i },
];

function categorizeTodos(todos: TodoRow[]): TaskCategory[] {
  const buckets = new Map<string, TodoRow[]>();
  const uncategorized: TodoRow[] = [];

  for (const todo of todos) {
    const haystack = [todo.task, todo.context ?? '', todo.category ?? ''].join(' ');
    let matched = false;
    for (const rule of CATEGORY_RULES) {
      if (rule.pattern.test(haystack)) {
        const existing = buckets.get(rule.id) ?? [];
        existing.push(todo);
        buckets.set(rule.id, existing);
        matched = true;
        break;
      }
    }
    if (!matched) uncategorized.push(todo);
  }

  const result: TaskCategory[] = [];
  for (const rule of CATEGORY_RULES) {
    const items = buckets.get(rule.id);
    if (items && items.length > 0) {
      result.push({ ...rule, items });
    }
  }
  if (uncategorized.length > 0) {
    result.push({ id: 'general', label: 'General', icon: '▦', color: LUCY_COLORS.textSubtle, items: uncategorized });
  }
  return result;
}

function formatDoneTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

/** Breathing amber glow — LUCY is alive and watching. The #1 premium wow moment.
 *  Runs entirely on the native thread (useNativeDriver: true). */
function HeroGlow() {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    ).start();
    return () => pulse.stopAnimation();
  }, []);
  return (
    <Animated.View style={[styles.heroGlow, {
      opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.08, 0.22] }),
      transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.90, 1.12] }) }],
    }]} />
  );
}

function AnimatedTodoRow({ todo, onPress, onLongPress }: { todo: TodoRow; onPress: () => void; onLongPress: () => void }) {
  const checkScale = useRef(new Animated.Value(1)).current;
  const checkFill = useRef(new Animated.Value(0)).current;
  const strikeWidth = useRef(new Animated.Value(0)).current;
  const rowOpacity = useRef(new Animated.Value(1)).current;

  const handlePress = () => {
    haptic.taskDone(); // medium tap, then 80ms later a light tap — double-tap feel
    setTimeout(() => haptic.taskUndo(), 80); // repurposed as the second lighter tap
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
        <TouchableOpacity style={styles.editBtn} onPress={onLongPress}>
          <Text style={styles.editBtnText}>⋯</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

function CategoryModal({
  category,
  onClose,
  onComplete,
  onAdd,
  onEdit,
}: {
  category: TaskCategory;
  onClose: () => void;
  onComplete: (todo: TodoRow) => void;
  onAdd: (text: string) => void;
  onEdit: (todo: TodoRow) => void;
}) {
  const [addText, setAddText] = useState('');
  // allItems tracks every item with its state: pending or done-pending-undo
  const [allItems, setAllItems] = useState<Array<{ todo: TodoRow; doneAt: number | null }>>(() =>
    category.items.map((todo) => ({ todo, doneAt: null })),
  );
  const slideAnim = useRef(new Animated.Value(400)).current;

  useEffect(() => {
    Animated.spring(slideAnim, { toValue: 0, friction: 9, tension: 70, useNativeDriver: true }).start();
  }, []);

  const close = () => {
    Animated.timing(slideAnim, { toValue: 400, duration: 220, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(onClose);
  };

  const handleCheck = (todo: TodoRow) => {
    // Mark done inline — no auto-archive, stays undoable until modal is closed
    setAllItems((prev) => prev.map((item) => item.todo.id === todo.id ? { ...item, doneAt: Date.now() } : item));
  };

  const handleUndo = (todo: TodoRow) => {
    setAllItems((prev) => prev.map((item) => item.todo.id === todo.id ? { ...item, doneAt: null } : item));
  };

  const handleClose = () => {
    // Commit all checked items when closing
    const doneItems = allItems.filter((i) => i.doneAt !== null).map((i) => i.todo);
    doneItems.forEach((todo) => onComplete(todo));
    close();
  };

  const pendingCount = allItems.filter((i) => i.doneAt === null).length;
  const urgentCount = allItems.filter((i) => i.doneAt === null && i.todo.urgency === 'high').length;

  const { height: screenHeight } = useWindowDimensions();
  // Pixel budget: sheet is capped at 80% of screen. Header ~78px, add-bar ~70px.
  // Give the ScrollView the remaining space so it reliably scrolls on all devices.
  // Sheet is capped by backdrop (full screen). Header≈78px, addBar≈58px, handle≈8px.
  // Use 70% of screen so there's room on small phones too.
  const listMaxHeight = Math.max(150, Math.round(screenHeight * 0.70) - 78 - 58);

  return (
    <Modal transparent animationType="none" visible onRequestClose={close}>
      {/* Backdrop: flex column — Pressable fills the space ABOVE the sheet,
          sheet itself needs no inner wrapper so ScrollView scrolls freely. */}
      <View style={cmStyles.backdrop}>
        <Pressable style={{ flex: 1 }} onPress={close} />
        <Animated.View style={[cmStyles.sheet, { transform: [{ translateY: slideAnim }] }]}>
          <View>
            {/* Header */}
            <View style={[cmStyles.header, { borderBottomColor: category.color + '33' }]}>
              <Text style={cmStyles.icon}>{category.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={cmStyles.title}>{category.label}</Text>
                <Text style={cmStyles.subtitle}>
                  {pendingCount} remaining{urgentCount > 0 ? ` · ${urgentCount} urgent` : ''}
                </Text>
              </View>
              <TouchableOpacity onPress={handleClose} style={cmStyles.closeBtn}>
                <Text style={cmStyles.closeBtnText}>Done</Text>
              </TouchableOpacity>
            </View>

            {/* Explicit maxHeight in pixels so the ScrollView always has a finite
                bounded size regardless of how many items are in the list. */}
            <ScrollView
              style={[cmStyles.list, { maxHeight: listMaxHeight }]}
              showsVerticalScrollIndicator
              keyboardShouldPersistTaps="handled"
            >
              {allItems.map(({ todo, doneAt }) =>
                doneAt === null ? (
                  // Pending item — normal animated row
                  <AnimatedTodoRow
                    key={todo.id}
                    todo={todo}
                    onPress={() => handleCheck(todo)}
                    onLongPress={() => onEdit(todo)}
                  />
                ) : (
                  // Done item — inline with undo button
                  <View key={todo.id} style={cmStyles.doneInlineRow}>
                    <View style={cmStyles.doneInlineCheck}>
                      <Text style={{ color: '#4ADE80', fontSize: 13, fontWeight: '900' }}>✓</Text>
                    </View>
                    <Text style={cmStyles.doneInlineText} numberOfLines={1}>{todo.task}</Text>
                    <TouchableOpacity style={cmStyles.undoBtn} onPress={() => handleUndo(todo)}>
                      <Text style={cmStyles.undoBtnText}>Undo</Text>
                    </TouchableOpacity>
                  </View>
                )
              )}
              {allItems.length === 0 ? (
                <Text style={{ color: LUCY_COLORS.textSubtle, textAlign: 'center', padding: 24, fontSize: 14 }}>
                  All done! ✓
                </Text>
              ) : null}
              <View style={{ height: 8 }} />
            </ScrollView>

            {/* Quick add */}
            <View style={cmStyles.addBar}>
              <TextInput
                style={cmStyles.addInput}
                placeholder={`Add to ${category.label}...`}
                placeholderTextColor={LUCY_COLORS.textSubtle}
                value={addText}
                onChangeText={setAddText}
                returnKeyType="done"
                onSubmitEditing={() => {
                  if (addText.trim()) { onAdd(addText.trim()); setAddText(''); }
                }}
              />
              <TouchableOpacity
                style={[cmStyles.addBtn, !addText.trim() && { opacity: 0.4 }]}
                disabled={!addText.trim()}
                onPress={() => { if (addText.trim()) { onAdd(addText.trim()); setAddText(''); } }}
              >
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16 }}>+</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const cmStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', flexDirection: 'column' },
  sheet: { backgroundColor: LUCY_COLORS.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderTopColor: LUCY_COLORS.border },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 20, borderBottomWidth: 1 },
  icon: { fontSize: 26 },
  title: { color: LUCY_COLORS.textDark, fontSize: 20, fontWeight: '800' },
  subtitle: { color: LUCY_COLORS.textSubtle, fontSize: 12, marginTop: 2 },
  closeBtn: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 10 },
  closeBtnText: { color: LUCY_COLORS.textMuted, fontSize: 13, fontWeight: '700' },
  list: { paddingHorizontal: 16, paddingTop: 8 },
  addBar: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16, borderTopWidth: 1, borderTopColor: LUCY_COLORS.divider },
  addInput: { flex: 1, backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, color: LUCY_COLORS.textDark, fontSize: 15, borderWidth: 1, borderColor: LUCY_COLORS.border },
  addBtn: { width: 38, height: 38, borderRadius: 12, backgroundColor: LUCY_COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  doneInlineRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 4, opacity: 0.7 },
  doneInlineCheck: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(74,222,128,0.15)', alignItems: 'center', justifyContent: 'center' },
  doneInlineText: { flex: 1, color: LUCY_COLORS.textSubtle, fontSize: 14, textDecorationLine: 'line-through' },
  undoBtn: { paddingHorizontal: 12, paddingVertical: 5, backgroundColor: LUCY_COLORS.primarySoft, borderRadius: 8, borderWidth: 1, borderColor: LUCY_COLORS.primary + '55' },
  undoBtnText: { color: LUCY_COLORS.primary, fontSize: 12, fontWeight: '700' },
});

// ─── Category Card ────────────────────────────────────────────────────────────

function CategoryCard({ category, onPress }: { category: TaskCategory; onPress: () => void }) {
  const urgentCount = category.items.filter((t) => t.urgency === 'high').length;
  const topTask = urgentCount > 0
    ? category.items.find((t) => t.urgency === 'high')
    : category.items[0];
  const scaleAnim = useRef(new Animated.Value(1)).current;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      onPressIn={() => Animated.spring(scaleAnim, { toValue: 0.97, friction: 30, tension: 400, useNativeDriver: true }).start()}
      onPressOut={() => Animated.spring(scaleAnim, { toValue: 1, friction: 18, tension: 200, useNativeDriver: true }).start()}
    >
      <Animated.View style={[ccStyles.card, { transform: [{ scale: scaleAnim }], borderLeftColor: category.color }]}>
        <View style={[ccStyles.iconWrap, { backgroundColor: category.color + '22' }]}>
          <Text style={ccStyles.iconText}>{category.icon}</Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={ccStyles.label}>{category.label}</Text>
            {urgentCount > 0 ? (
              <View style={{ backgroundColor: category.color + '28', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 }}>
                <Text style={{ color: category.color, fontSize: 9, fontWeight: '800', letterSpacing: 0.8 }}>{urgentCount} URGENT</Text>
              </View>
            ) : null}
          </View>
          {topTask ? (
            <Text style={ccStyles.preview} numberOfLines={1}>{topTask.task}</Text>
          ) : null}
          <Text style={ccStyles.count}>
            {category.items.length} item{category.items.length !== 1 ? 's' : ''}
          </Text>
        </View>
        <Text style={ccStyles.chevron}>›</Text>
      </Animated.View>
    </TouchableOpacity>
  );
}

const ccStyles = StyleSheet.create({
  card: { backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 16, borderWidth: 1, borderColor: LUCY_COLORS.border, borderTopColor: '#3A3028', borderLeftWidth: 4, flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, marginBottom: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.28, shadowRadius: 6, elevation: 4 },
  iconWrap: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  iconText: { fontSize: 20 },
  label: { color: LUCY_COLORS.textDark, fontSize: 15, fontWeight: '700', letterSpacing: -0.1 },
  preview: { color: LUCY_COLORS.textMuted, fontSize: 12, lineHeight: 17 },
  count: { color: LUCY_COLORS.textSubtle, fontSize: 11 },
  urgentDot: { width: 8, height: 8, borderRadius: 4 },
  chevron: { color: LUCY_COLORS.textSubtle, fontSize: 22, fontWeight: '300' },
});

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export function CaptureScreen({
  refreshToken,
  onQueued,
  passiveState,
  onToggleListen,
  onMeeting,
}: {
  refreshToken: number;
  onQueued: () => void;
  passiveState?: PassiveListenerState;
  onToggleListen?: () => void;
  backgroundEnabled?: boolean;
  onBackgroundPress?: () => void;
  onMeeting?: () => void;
}) {
  const [text, setText] = useState('');
  const [todos, setTodos] = useState<TodoRow[]>([]);
  const [userName, setUserName] = useState('');
  const scrollY = useRef(new Animated.Value(0)).current;
  const heroOpacity = scrollY.interpolate({ inputRange: [0, 80], outputRange: [1, 0], extrapolate: 'clamp' });

  // WhatsApp-style voice button animation
  const micScale = useRef(new Animated.Value(1)).current;
  const micRadius = useRef(new Animated.Value(23)).current;
  const sendScale = useRef(new Animated.Value(1)).current;
  const ackAnim = useRef(new Animated.Value(20)).current;
  const ackOpacity = useRef(new Animated.Value(0)).current;
  const [done, setDone] = useState<DoneEntry[]>([]);
  const [sending, setSending] = useState(false);
  const [acknowledgement, setAcknowledgement] = useState('');
  const [markedPrivate, setMarkedPrivate] = useState(false);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const [pendingTodo, setPendingTodo] = useState<TodoRow | null>(null);
  const [doneNotes, setDoneNotes] = useState('');
  const [editTodo, setEditTodo] = useState<TodoRow | null>(null);
  const [editText, setEditText] = useState('');
  const [capturedToday, setCapturedToday] = useState(0);
  const [captureStreak, setCaptureStreak] = useState(0);
  const [voiceRecording, setVoiceRecording] = useState(false);
  const [scanningReceipt, setScanningReceipt] = useState(false);
  const [replayExtraction, setReplayExtraction] = useState<ExtractionResult | null>(null);
  const [pendingAction, setPendingAction] = useState<ExtractedAction | null>(null);
  const [executingAction, setExecutingAction] = useState(false);
  const [openCategory, setOpenCategory] = useState<TaskCategory | null>(null);
  type RecInst = { prepareToRecordAsync(): Promise<void>; record(): void; stop(): Promise<void>; uri: string | null; release?: () => void };
  const audioRecorder = useRef<RecInst | null>(null);
  const speechSubscriptions = useRef<Array<{ remove(): void }>>([]);

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
      const [pendingTodosResult, { getUserProfile }] = await Promise.all([
        listPendingTodos(db),
        import('../db/userProfile'),
      ]);
      setTodos(pendingTodosResult);
      const profile = await getUserProfile(db);
      setUserName(profile.name || '');
      // Today's capture count + streak
      const todayRow = await db.getFirstAsync<{ n: number }>(
        `SELECT COUNT(*) AS n FROM captures WHERE date(created_at) = date('now') AND archived_at IS NULL`,
      );
      setCapturedToday(todayRow?.n ?? 0);
      // Calculate streak (consecutive days with at least 1 capture)
      const dayRows = await db.getAllAsync<{ d: string }>(
        `SELECT DISTINCT date(created_at) AS d FROM captures WHERE archived_at IS NULL AND created_at >= datetime('now', '-30 days') ORDER BY d DESC`,
      );
      let streak = 0;
      const today = new Date().toISOString().slice(0, 10);
      for (let i = 0; i < dayRows.length; i++) {
        const expected = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
        if (dayRows[i].d === expected) streak++;
        else break;
      }
      // Streak only counts if captured today
      setCaptureStreak(dayRows[0]?.d === today ? streak : 0);
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
  };

  const saveEditTodo = async () => {
    if (!editTodo || !editText.trim()) return;
    const db = await getDatabase();
    await db.runAsync('UPDATE todos SET task = ? WHERE id = ?', editText.trim(), editTodo.id);
    setTodos((prev) => prev.map((t) => t.id === editTodo.id ? { ...t, task: editText.trim() } : t));
    setEditTodo(null);
  };

  const deleteTodo = async (todo: TodoRow) => {
    const db = await getDatabase();
    await archiveTodo(db, todo.id, 'deleted');
    setTodos((prev) => prev.filter((t) => t.id !== todo.id));
    setEditTodo(null);
  };

  const undoDone = async (entry: DoneEntry) => {
    // Put the task back in todos list (re-insert visually; DB is archived but UX restores it)
    setDone((prev) => prev.filter((e) => e.todo.id !== entry.todo.id));
    setTodos((prev) => [entry.todo, ...prev]);
  };

  const scanReceipt = async () => {
    setScanningReceipt(true);
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Camera access needed',
          'LUCY needs camera access to scan receipts. Go to Settings → LUCY → Camera and turn it on.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ],
        );
        return;
      }
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7, allowsEditing: false });
      if (result.canceled || !result.assets[0]) return;
      const { processReceiptImage, receiptToCapture } = await import('../processing/receiptOCR');
      const receipt = await processReceiptImage(result.assets[0].uri);
      const captureText = receiptToCapture(receipt);
      setText(captureText);
    } catch {
      Alert.alert('Could not scan', 'Something went wrong with the camera.');
    } finally {
      setScanningReceipt(false);
    }
  };

  const animateMicToRecording = () => {
    Animated.parallel([
      Animated.spring(micScale, { toValue: 1.18, useNativeDriver: false }),
      Animated.timing(micRadius, { toValue: 14, duration: 200, easing: Easing.out(Easing.quad), useNativeDriver: false }),
    ]).start();
  };

  const animateMicToIdle = () => {
    Animated.parallel([
      Animated.spring(micScale, { toValue: 1, useNativeDriver: false }),
      Animated.timing(micRadius, { toValue: 23, duration: 200, easing: Easing.out(Easing.quad), useNativeDriver: false }),
    ]).start();
  };

  const toggleVoiceInput = async () => {
    const clearSpeechSubscriptions = () => {
      for (const subscription of speechSubscriptions.current) subscription.remove();
      speechSubscriptions.current = [];
    };

    if (voiceRecording) {
      animateMicToIdle();
      setVoiceRecording(false);
      if (speechSubscriptions.current.length > 0) {
        try { ExpoSpeechRecognitionModule.stop(); } catch { /* already stopped */ }
        await new Promise<void>((resolve) => setTimeout(resolve, 300));
        clearSpeechSubscriptions();
      } else if (audioRecorder.current) {
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

    try {
      const microphonePermission = await ExpoSpeechRecognitionModule.requestMicrophonePermissionsAsync();
      if (!microphonePermission.granted) {
        Alert.alert(
          'Microphone access needed',
          'LUCY needs microphone access to record voice. Go to Settings → Apps → LUCY → Microphone and turn it on.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ],
        );
        return;
      }

      if (ExpoSpeechRecognitionModule.isRecognitionAvailable() && ExpoSpeechRecognitionModule.supportsOnDeviceRecognition()) {
        const { getOnDeviceSpeechLocale, getUserProfile } = await import('../db/userProfile');
        const db = await getDatabase();
        const profile = await getUserProfile(db);
        const locale = getOnDeviceSpeechLocale(profile);
        clearSpeechSubscriptions();
        speechSubscriptions.current = [
          ExpoSpeechRecognitionModule.addListener('result', (event: ExpoSpeechRecognitionResultEvent) => {
            if (!event.isFinal) return;
            const transcript = event.results[0]?.transcript.trim() ?? '';
            if (transcript) setText((prev) => prev ? `${prev} ${transcript}` : transcript);
          }),
          ExpoSpeechRecognitionModule.addListener('error', (event: ExpoSpeechRecognitionErrorEvent) => {
            if (event.error === 'aborted' || event.error === 'no-speech') return;
            clearSpeechSubscriptions();
            animateMicToIdle();
            setVoiceRecording(false);
            Alert.alert('On-device transcription failed', `${event.error}: ${event.message}`);
          }),
          ExpoSpeechRecognitionModule.addListener('end', () => {
            clearSpeechSubscriptions();
            animateMicToIdle();
            setVoiceRecording(false);
          }),
        ];
        ExpoSpeechRecognitionModule.start({
          lang: locale,
          interimResults: false,
          maxAlternatives: 1,
          continuous: false,
          requiresOnDeviceRecognition: true,
          addsPunctuation: true,
        });
      } else {
        // Keep the one-shot voice button useful on devices without a local recognizer.
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        audioRecorder.current = new AR(RecordingPresets.HIGH_QUALITY);
        await audioRecorder.current.prepareToRecordAsync();
        audioRecorder.current.record();
      }
      haptic.listenStart();
      animateMicToRecording();
      setVoiceRecording(true);
    } catch (error) {
      clearSpeechSubscriptions();
      Alert.alert('Could not start recording', error instanceof Error ? error.message : 'Check microphone permission in Settings → LUCY.');
    }
  };

  const sendCapture = async () => {
    const outgoing = text.trim();
    if (!outgoing) return;

    // Detect automation intent FIRST — if high confidence, show confirmation instead of queuing
    const autoAction = detectAutomationIntent(outgoing);
    if (autoAction && autoAction.confidence >= 0.8) {
      setText('');
      Keyboard.dismiss();
      setPendingAction(autoAction);
      // Still save the thought as a memory — a misfired detection must never lose it.
      const wasPrivate = markedPrivate;
      setMarkedPrivate(false);
      void enqueueTranscript(outgoing, 'text', wasPrivate).then(() => onQueued()).catch(() => {});
      return;
    }

    try {
      setSending(true);
      await enqueueTranscript(outgoing, 'text', markedPrivate);
      haptic.capture(); // success — the most important haptic in the app
      setText('');
      const msg = markedPrivate ? 'Protected thought queued' : 'Got it ✓';
      setAcknowledgement(msg);
      ackAnim.setValue(20); ackOpacity.setValue(0);
      Animated.parallel([
        Animated.spring(ackAnim, { toValue: 0, friction: 16, tension: 200, useNativeDriver: true }),
        Animated.timing(ackOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      ]).start();
      setMarkedPrivate(false);
      onQueued();

      // Run extraction in background to power the Live Capture Replay
      if (!markedPrivate) {
        analyzeTranscript(outgoing).then(setReplayExtraction).catch(() => {});
      }

      setTimeout(() => setAcknowledgement(''), 2000);
    } catch (error) {
      Alert.alert('Could not save this', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setSending(false);
    }
  };

  const categories = categorizeTodos(todos);
  const signalCount = todos.filter((t) => t.urgency === 'high').length;

  // Label shown in the listen pill — gives real feedback in batch (Whisper) mode
  function listenPillLabel(): string {
    if (!passiveState || passiveState.status !== 'listening') return 'Listen';
    if (passiveState.noApiKey) return 'No key';
    if (passiveState.mode === 'batch') {
      if (passiveState.wordsHeard > 0) return `${passiveState.wordsHeard}w`;
      const s = passiveState.recordingSeconds;
      if (s < 60) return `Rec ${s}s`;
      return `Rec ${Math.floor(s / 60)}m${s % 60 > 0 ? `${s % 60}s` : ''}`;
    }
    return `${passiveState.wordsHeard}w`;
  }

  return (
    <View style={[styles.container, { paddingBottom: keyboardOffset }]}>



      <Animated.ScrollView
        style={styles.board}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
        scrollEventThrottle={16}
      >
        {/* Hero lives inside the scroll view — scrolls away naturally, always comes back */}
        <Animated.View style={[styles.hero, { opacity: heroOpacity }]}>
          <HeroGlow />
          <Text style={styles.heroGreeting}>{getGreeting()}{userName ? `, ${userName}` : ''}</Text>
          <Text style={styles.heroTitle}>LUCY</Text>
          <Text style={styles.heroPillars}>Listen · Understand · Connect · Yield</Text>
          <View style={styles.heroCard}>
            <Text style={styles.heroCardLabel}>LUCY IS ACTIVE</Text>
            <Text style={styles.heroCardTitle}>
              {signalCount > 0 ? `${signalCount} urgent signal${signalCount !== 1 ? 's' : ''} for you` : 'All caught up'}
            </Text>
            {/* Stats row */}
            <View style={{ flexDirection: 'row', gap: 16, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(255,140,66,0.2)' }}>
              <View style={{ alignItems: 'center', gap: 2 }}>
                <Text style={{ color: LUCY_COLORS.primary, fontSize: 20, fontWeight: '900' }}>{capturedToday}</Text>
                <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 10, fontWeight: '600', letterSpacing: 0.5 }}>today</Text>
              </View>
              {captureStreak > 1 ? (
                <View style={{ alignItems: 'center', gap: 2 }}>
                  <Text style={{ color: '#F59E0B', fontSize: 20, fontWeight: '900' }}>{captureStreak}🔥</Text>
                  <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 10, fontWeight: '600', letterSpacing: 0.5 }}>day streak</Text>
                </View>
              ) : null}
              {todos.length > 0 ? (
                <View style={{ alignItems: 'center', gap: 2 }}>
                  <Text style={{ color: '#60A5FA', fontSize: 20, fontWeight: '900' }}>{todos.length}</Text>
                  <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 10, fontWeight: '600', letterSpacing: 0.5 }}>tasks</Text>
                </View>
              ) : null}
            </View>
          </View>
        </Animated.View>

        {categories.length === 0 && done.length === 0 ? (
          <View style={styles.emptyBoard}>
            {/* AmberPulse — LUCY is listening */}
            <View style={{ alignItems: 'center', justifyContent: 'center', width: 80, height: 80, marginBottom: 16 }}>
              <View style={{ position: 'absolute', width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(255,140,66,0.06)' }} />
              <View style={{ position: 'absolute', width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(255,140,66,0.10)' }} />
              <View style={{ position: 'absolute', width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,140,66,0.16)' }} />
              <Text style={{ fontSize: 16 }}>✓</Text>
            </View>
            <Text style={styles.emptyTitle}>All clear</Text>
            <Text style={styles.emptyHint}>Speak a thought or type anything. LUCY extracts tasks, ideas, and reminders automatically.</Text>
          </View>
        ) : (
          <>
            {/* Category cards — tap to open overlay checklist */}
            <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
              {categories.map((cat) => (
                <CategoryCard
                  key={cat.id}
                  category={cat}
                  onPress={() => setOpenCategory(cat)}
                />
              ))}
            </View>

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
      </Animated.ScrollView>

      {acknowledgement ? (
        <Animated.View style={[styles.ack, { transform: [{ translateY: ackAnim }], opacity: ackOpacity }]}>
          <Text style={styles.ackText}>{acknowledgement}</Text>
        </Animated.View>
      ) : null}

      {/* Automation confirmation card */}
      {pendingAction ? (
        <View style={styles.autoCard}>
          <Text style={styles.autoCardLabel}>LUCY CAN DO THIS</Text>
          <Text style={styles.autoCardTitle}>{pendingAction.displayText}</Text>
          <View style={styles.autoCardButtons}>
            <TouchableOpacity
              style={[styles.autoConfirmBtn, executingAction && { opacity: 0.5 }]}
              disabled={executingAction}
              onPress={async () => {
                setExecutingAction(true);
                const result = await executeAction(pendingAction);
                setExecutingAction(false);
                setPendingAction(null);
                setAcknowledgement(result.success ? `Done — ${result.message}` : `Could not — ${result.message}`);
                setTimeout(() => setAcknowledgement(''), 3000);
              }}
            >
              <Text style={styles.autoConfirmText}>{executingAction ? '...' : pendingAction.confirmText}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.autoCancelBtn} onPress={() => setPendingAction(null)}>
              <Text style={styles.autoCancelText}>Not now</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {/* Keyboard dismiss bar — visible when keyboard is open */}
      {keyboardOffset > 0 ? (
        <TouchableOpacity style={styles.keyboardDismissBar} onPress={() => Keyboard.dismiss()}>
          <Text style={styles.keyboardDismissText}>Done  ▾</Text>
        </TouchableOpacity>
      ) : null}

      <View style={styles.composerDock}>
        <View style={styles.composer}>
          <TouchableOpacity style={styles.cameraButton} onPress={() => void scanReceipt()} disabled={scanningReceipt} activeOpacity={0.8}>
            <Text style={styles.cameraIcon}>{scanningReceipt ? '⏳' : '📷'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => void toggleVoiceInput()} activeOpacity={0.8}>
            <Animated.View style={[
              styles.micButton,
              {
                transform: [{ scale: micScale }],
                borderRadius: micRadius,
                backgroundColor: voiceRecording ? LUCY_COLORS.primary : LUCY_COLORS.surfaceRaised,
                borderColor: voiceRecording ? LUCY_COLORS.primary : LUCY_COLORS.border,
              },
            ]}>
              <Text style={[styles.micIcon, voiceRecording && { color: '#fff' }]}>
                {voiceRecording ? '⏹' : '🎤'}
              </Text>
            </Animated.View>
          </TouchableOpacity>
          <TextInput
            multiline
            placeholder="Manage todo list"
            placeholderTextColor={LUCY_COLORS.textSubtle}
            style={styles.input}
            textAlignVertical="top"
            value={text}
            onChangeText={setText}
          />
          <TouchableOpacity
            onPressIn={() => Animated.spring(sendScale, { toValue: 0.94, friction: 30, tension: 450, useNativeDriver: true }).start()}
            onPressOut={() => Animated.spring(sendScale, { toValue: 1, friction: 14, tension: 180, useNativeDriver: true }).start()}
            onPress={() => void sendCapture()}
            disabled={sending || !text.trim()}
          >
            <Animated.View style={[styles.sendButton, !text.trim() && styles.sendDisabled, { transform: [{ scale: sendScale }] }]}>
              <Text style={styles.sendText}>{sending ? '...' : 'Send'}</Text>
            </Animated.View>
          </TouchableOpacity>
        </View>
      </View>

      {/* Edit todo modal */}
      <Modal transparent animationType="fade" visible={editTodo !== null} onRequestClose={() => setEditTodo(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setEditTodo(null)}>
          <Pressable style={styles.modalCard}>
            <Text style={styles.modalTitle}>Edit task</Text>
            <TextInput
              style={[styles.modalInput, { minHeight: 48 }]}
              value={editText}
              onChangeText={setEditText}
              autoFocus
              multiline
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity style={[styles.modalSkip, { flex: 1, borderColor: '#ef4444' }]} onPress={() => void deleteTodo(editTodo!)}>
                <Text style={[styles.modalSkipText, { color: '#ef4444' }]}>Delete</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalDone} onPress={() => void saveEditTodo()}>
                <Text style={styles.modalDoneText}>Save</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

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

      {/* Category checklist modal */}
      {openCategory ? (
        <CategoryModal
          category={openCategory}
          onClose={() => setOpenCategory(null)}
          onComplete={async (todo) => {
            // Confirmed done after 4s undo window — archive and remove from board
            const db = await getDatabase();
            await archiveTodo(db, todo.id, 'done').catch(() => {});
            setTodos((prev) => prev.filter((t) => t.id !== todo.id));
          }}
          onEdit={(todo) => { setOpenCategory(null); setEditTodo(todo); }}
          onAdd={async (text) => {
            const db = await getDatabase();
            await db.runAsync(
              'INSERT INTO todos (task, category, urgency, context, privacy_level, created_at) VALUES (?, ?, ?, ?, ?, ?)',
              text, 'other', 'medium', openCategory.label, 'normal', new Date().toISOString(),
            );
            const newTodo = await db.getFirstAsync<TodoRow>(
              'SELECT * FROM todos WHERE id = last_insert_rowid()',
            );
            if (newTodo) {
              setTodos((prev) => [...prev, newTodo]);
              const updatedCat = { ...openCategory, items: [...openCategory.items, newTodo] };
              setOpenCategory(updatedCat);
            }
          }}
        />
      ) : null}

      {/* Live Capture Replay — the "wow moment" */}
      {replayExtraction ? (
        <CaptureReplay
          extraction={replayExtraction}
          onDismiss={() => setReplayExtraction(null)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  board: { flex: 1 },
  controlBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8, paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: LUCY_COLORS.divider },
  controlPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: LUCY_COLORS.surfaceRaised, borderWidth: 1, borderColor: LUCY_COLORS.border, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 5 },
  controlBgPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: LUCY_COLORS.primarySoft, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 5 },
  controlMeetingPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(239,68,68,0.1)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)', borderRadius: 16, paddingHorizontal: 10, paddingVertical: 5 },
  controlBrainPill: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: LUCY_COLORS.primarySoft, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 5, maxWidth: 130 },
  // Hero
  hero: { backgroundColor: '#1a0f00', paddingHorizontal: 24, paddingTop: 20, paddingBottom: 16, position: 'relative', overflow: 'hidden' },
  heroGlow: { position: 'absolute', top: -40, right: -40, width: 200, height: 200, borderRadius: 100, backgroundColor: '#FF8C42' },
  heroGreeting: { fontSize: 12, fontWeight: '700', color: LUCY_COLORS.primary, letterSpacing: 0.5, marginBottom: 2 },
  heroTitle: { fontSize: 42, fontWeight: '900', letterSpacing: -2.5, color: LUCY_COLORS.textDark, lineHeight: 46, marginBottom: 2 },
  heroPillars: { fontSize: 11, color: LUCY_COLORS.textSubtle, marginBottom: 12 },
  heroCard: { backgroundColor: 'rgba(255,140,66,0.07)', borderWidth: 1, borderColor: 'rgba(255,140,66,0.25)', borderRadius: 14, padding: 12 },
  heroCardLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, color: LUCY_COLORS.primary, marginBottom: 4 },
  heroCardTitle: { fontSize: 18, fontWeight: '800', color: LUCY_COLORS.textDark },  // was 15 — more punchy
  // Compact header
  compactHeader: { paddingHorizontal: 20, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: LUCY_COLORS.background, borderBottomWidth: 1, borderBottomColor: LUCY_COLORS.border },
  compactLogo: { fontSize: 20, fontWeight: '900', letterSpacing: 1.5, color: LUCY_COLORS.textDark },
  compactPills: { flexDirection: 'row', gap: 8 },
  compactPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: LUCY_COLORS.surfaceRaised, borderWidth: 1, borderColor: LUCY_COLORS.border, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 5 },
  compactPillActive: { backgroundColor: '#1a0a00', borderColor: LUCY_COLORS.primary },
  compactBgPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: LUCY_COLORS.primarySoft, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 5 },
  meetingCompactPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(239,68,68,0.1)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)', borderRadius: 16, paddingHorizontal: 10, paddingVertical: 5 },
  compactDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: LUCY_COLORS.textSubtle },
  compactPillText: { fontSize: 11, fontWeight: '700', color: LUCY_COLORS.textMuted },
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
  editBtn: { paddingHorizontal: 6, paddingVertical: 2 },
  editBtnText: { color: LUCY_COLORS.textSubtle, fontSize: 18, fontWeight: '700', letterSpacing: 1 },
  undoText: { color: LUCY_COLORS.primaryGlow, fontSize: 11, fontWeight: '700' },
  // Capture
  ack: { alignSelf: 'center', backgroundColor: LUCY_COLORS.primarySoft, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, marginBottom: 8 },
  keyboardDismissBar: { alignSelf: 'flex-end', paddingHorizontal: 18, paddingVertical: 6, marginBottom: 2 },
  keyboardDismissText: { color: LUCY_COLORS.primary, fontSize: 14, fontWeight: '700' },
  autoCard: { marginHorizontal: 16, marginBottom: 10, backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 18, borderWidth: 1, borderColor: LUCY_COLORS.primary + '44', padding: 16, gap: 10 },
  autoCardLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.4, color: LUCY_COLORS.primary, textTransform: 'uppercase' },
  autoCardTitle: { fontSize: 17, fontWeight: '700', color: LUCY_COLORS.textDark },
  autoCardButtons: { flexDirection: 'row', gap: 10 },
  autoConfirmBtn: { flex: 1, backgroundColor: LUCY_COLORS.primary, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  autoConfirmText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  autoCancelBtn: { paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center' },
  autoCancelText: { color: LUCY_COLORS.textSubtle, fontSize: 14 },
  ackText: { color: LUCY_COLORS.primaryGlow, fontSize: 12, fontWeight: '700' },
  composerDock: { borderTopWidth: 1, borderTopColor: LUCY_COLORS.divider, paddingTop: 4 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 9, paddingTop: 8 },
  cameraButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: LUCY_COLORS.surfaceRaised, borderWidth: 1, borderColor: LUCY_COLORS.border, alignItems: 'center', justifyContent: 'center' },
  cameraIcon: { fontSize: 18 },
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
