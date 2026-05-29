import { useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { LUCY_COLORS } from '../config/colors';
import { getDatabase } from '../db';
import {
  createAskThread,
  insertLucyAskMessage,
  insertUserAskMessage,
  listAskMessages,
  listAskThreads,
  type AskThreadSummaryRow,
} from '../db/askThreads';
import { askLucy, type LucyAnswer } from '../processing/ask';
import { isInvalidDeadline, isInvalidPendingTask } from '../processing/artifactCleanup';
import { protectedPreview } from '../processing/privacy';

const exampleQuestion = 'What tasks and deadlines need my attention today?';

type ChatMessage =
  | { id: string; role: 'lucy'; text: string; answer?: undefined }
  | { id: string; role: 'lucy'; text?: undefined; answer: LucyAnswer }
  | { id: string; role: 'user'; text: string; answer?: undefined };

const welcomeMessage: ChatMessage = {
  id: 'welcome',
  role: 'lucy',
  text: 'Ask about today, or name a project, area, or person to explore connected memory. I answer on this device.',
};

export function AskScreen() {
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([welcomeMessage]);
  const [asking, setAsking] = useState(false);
  const [threadId, setThreadId] = useState<number>();
  const [view, setView] = useState<'new' | 'history' | 'thread'>('new');
  const [history, setHistory] = useState<AskThreadSummaryRow[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const conversationRef = useRef<ScrollView>(null);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, (e) => setKeyboardOffset(e.endCoordinates.height));
    const hide = Keyboard.addListener(hideEvent, () => setKeyboardOffset(0));
    return () => { show.remove(); hide.remove(); };
  }, []);

  function scrollToLatest() {
    setTimeout(() => conversationRef.current?.scrollToEnd({ animated: true }), 20);
  }

  function startNewChat() {
    setView('new');
    setThreadId(undefined);
    setQuestion('');
    setMessages([welcomeMessage]);
  }

  async function openHistory() {
    setLoadingHistory(true);
    const db = await getDatabase();
    setHistory(await listAskThreads(db));
    setView('history');
    setLoadingHistory(false);
  }

  async function openThread(thread: AskThreadSummaryRow) {
    setLoadingHistory(true);
    const db = await getDatabase();
    const storedMessages = await listAskMessages(db, thread.id);
    const restored = storedMessages.flatMap<ChatMessage>((message) => {
      if (message.role === 'user' && message.text) {
        return [{ id: `stored-${message.id}`, role: 'user', text: message.text }];
      }
      if (message.role === 'lucy' && message.answer_json) {
        try {
          return [{
            id: `stored-${message.id}`,
            role: 'lucy',
            answer: JSON.parse(message.answer_json) as LucyAnswer,
          }];
        } catch {
          return [];
        }
      }
      return [];
    });
    setThreadId(thread.id);
    setMessages([welcomeMessage, ...restored]);
    setView('thread');
    setLoadingHistory(false);
    scrollToLatest();
  }

  async function ask(presetQuestion?: string) {
    const trimmed = (presetQuestion ?? question).trim();
    if (!trimmed || asking) {
      return;
    }
    const messageId = `${Date.now()}`;
    const db = await getDatabase();
    let currentThreadId = threadId;
    if (!currentThreadId) {
      const thread = await createAskThread(db, trimmed.slice(0, 62));
      currentThreadId = thread.id;
      setThreadId(thread.id);
      setView('thread');
    }
    await insertUserAskMessage(db, currentThreadId, trimmed);
    setMessages((existing) => [...existing, { id: `user-${messageId}`, role: 'user', text: trimmed }]);
    setQuestion('');
    setAsking(true);
    scrollToLatest();
    try {
      const answer = await askLucy(trimmed);
      await insertLucyAskMessage(db, currentThreadId, answer);
      setMessages((existing) => [...existing, { id: `lucy-${messageId}`, role: 'lucy', answer }]);
    } finally {
      setAsking(false);
      scrollToLatest();
    }
  }

  return (
    <View style={[styles.container, { paddingBottom: keyboardOffset }]}>
      <View style={styles.heading}>
        <View style={styles.headingRow}>
          <Text style={styles.title}>Ask LUCY</Text>
          <View style={styles.headingActions}>
            {view !== 'new' ? (
              <TouchableOpacity style={styles.actionButton} onPress={startNewChat}>
                <Text style={styles.actionText}>New chat</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={styles.actionButton} onPress={() => void openHistory()}>
              <Text style={styles.actionText}>History</Text>
            </TouchableOpacity>
          </View>
        </View>
        <Text style={styles.subtitle}>{view === 'history' ? 'Past conversations, stored privately on this device.' : 'Private answers from your memory, on this device.'}</Text>
      </View>
      {view === 'history' ? (
        <HistoryView history={history} loading={loadingHistory} onSelect={openThread} />
      ) : (
        <>
          <ScrollView
            ref={conversationRef}
            style={styles.conversation}
            contentContainerStyle={styles.thread}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => conversationRef.current?.scrollToEnd({ animated: true })}
          >
            {messages.map((message) => <MessageBubble key={message.id} message={message} />)}
            {messages.length === 1 ? (
              <TouchableOpacity style={styles.suggestion} onPress={() => void ask(exampleQuestion)}>
                <Text style={styles.suggestionLabel}>SUGGESTED QUESTION</Text>
                <Text style={styles.suggestionText}>{exampleQuestion}</Text>
              </TouchableOpacity>
            ) : null}
            {asking ? (
              <View style={[styles.bubble, styles.lucyBubble]}>
                <Text style={styles.thinking}>Looking through memory...</Text>
              </View>
            ) : null}
          </ScrollView>
          <View style={styles.composer}>
            <TextInput
              multiline
              value={question}
              onChangeText={setQuestion}
              placeholder={threadId ? 'Ask a follow-up...' : 'Ask LUCY anything...'}
              placeholderTextColor={LUCY_COLORS.textMuted}
              style={styles.input}
            />
            <TouchableOpacity
              accessibilityLabel="Send question"
              style={[styles.send, (!question.trim() || asking) && styles.disabled]}
              onPress={() => void ask()}
              disabled={!question.trim() || asking}
            >
              <Text style={styles.sendText}>Ask</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}

function HistoryView({
  history,
  loading,
  onSelect,
}: {
  history: AskThreadSummaryRow[];
  loading: boolean;
  onSelect: (thread: AskThreadSummaryRow) => Promise<void>;
}) {
  return (
    <ScrollView style={styles.conversation} contentContainerStyle={styles.thread}>
      {loading ? <Text style={styles.thinking}>Opening history...</Text> : null}
      {!loading && history.map((thread) => (
        <TouchableOpacity key={thread.id} style={styles.historyCard} onPress={() => void onSelect(thread)}>
          <Text style={styles.historyTitle} numberOfLines={2}>{thread.first_question}</Text>
          <Text style={styles.historyMeta}>
            {new Date(`${thread.updated_at.replace(' ', 'T')}Z`).toLocaleString()} / {thread.message_count} messages
          </Text>
        </TouchableOpacity>
      ))}
      {!loading && !history.length ? <Text style={styles.emptyHistory}>No past conversations yet.</Text> : null}
    </ScrollView>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === 'user') {
    return (
      <View style={[styles.bubble, styles.userBubble]}>
        <Text style={styles.userText}>{message.text}</Text>
      </View>
    );
  }
  if (!message.answer) {
    return (
      <View style={[styles.bubble, styles.lucyBubble]}>
        <Text style={styles.lucyText}>{message.text}</Text>
      </View>
    );
  }
  const answer = message.answer;
  if (answer.answerKind === 'memory') {
    return <MemoryAnswerBubble answer={answer} />;
  }
  if (answer.answerKind === 'spending') {
    return <SpendingAnswerBubble answer={answer} />;
  }
  const tasks = answer.tasks.filter((task) => !isInvalidPendingTask(task));
  const deadlines = answer.deadlines.filter((deadline) => !isInvalidDeadline(deadline));
  const taskScopeLabel = answer.taskScope ? ` for ${answer.taskScope}` : '';
  const hasAnything = tasks.length > 0 || deadlines.length > 0;
  return (
    <View style={[styles.bubble, styles.lucyBubble]}>
      <Text style={styles.responseLabel}>LUCY</Text>
      {!hasAnything ? (
        <>
          <Text style={styles.answerMessage}>
            {`Nothing captured${taskScopeLabel} yet — here's how to get something here:`}
          </Text>
          <View style={styles.tipList}>
            <Text style={styles.tipItem}>{'→  "Meeting with Sam about Q3, need to follow up on budget"'}</Text>
            <Text style={styles.tipItem}>{'→  "Remind me to call the client tomorrow morning"'}</Text>
            <Text style={styles.tipItem}>{'→  "Deadline: submit the proposal by Friday"'}</Text>
          </View>
          <Text style={styles.tipHint}>Mention names, projects, and deadlines in Capture — LUCY picks them up automatically.</Text>
        </>
      ) : (
        <>
          {tasks.length > 0 ? (
            <>
              <Text style={styles.section}>{`Tasks${taskScopeLabel}`}</Text>
              {tasks.map((task) => (
                <View style={styles.row} key={task.id}>
                  <Text style={styles.rowText}>{protectedPreview(task.task)}</Text>
                </View>
              ))}
            </>
          ) : null}
          {deadlines.length > 0 ? (
            <>
              <Text style={styles.section}>Deadlines today</Text>
              {deadlines.map((deadline) => (
                <View style={styles.row} key={deadline.id}>
                  <View style={styles.deadline}>
                    <Text style={styles.rowText}>{protectedPreview(deadline.text)}</Text>
                    <Text style={styles.time}>{new Date(deadline.remind_at as string).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}</Text>
                  </View>
                </View>
              ))}
            </>
          ) : null}
        </>
      )}
      {answer.recordedSignal ? <Text style={styles.signal}>{answer.recordedSignal}</Text> : null}
    </View>
  );
}

function MemoryAnswerBubble({ answer }: { answer: LucyAnswer }) {
  const connections = answer.connections ?? [];
  const sources = answer.sources ?? [];
  return (
    <View style={[styles.bubble, styles.lucyBubble]}>
      <Text style={styles.responseLabel}>LUCY MEMORY</Text>
      <Text style={styles.answerTitle}>{answer.title}</Text>
      <Text style={styles.answerMessage}>{answer.message}</Text>
      {connections.length ? (
        <>
          <Text style={styles.section}>Connections ({connections.length})</Text>
          {connections.map((connection) => (
            <View style={styles.row} key={connection.statement}>
              <View style={styles.deadline}>
                <Text style={styles.rowText}>{protectedPreview(connection.statement)}</Text>
                <Text style={styles.time}>
                  {connection.confidence} / {connection.evidenceCount} supporting thought{connection.evidenceCount === 1 ? '' : 's'}
                </Text>
              </View>
            </View>
          ))}
        </>
      ) : null}
      <Text style={styles.section}>Remembered Context ({sources.length})</Text>
      {sources.map((source) => (
        <View style={styles.sourceCard} key={source.captureId}>
          <Text style={styles.sourceTitle}>{protectedPreview(source.title)}</Text>
          {source.actions.map((action) => (
            <Text style={styles.sourceAction} key={action}>Action: {protectedPreview(action)}</Text>
          ))}
          {!source.actions.length && source.summary ? (
            <Text style={styles.sourceAction}>{protectedPreview(source.summary)}</Text>
          ) : null}
        </View>
      ))}
      {!sources.length ? <Text style={styles.emptySection}>No connected context is remembered yet.</Text> : null}
      <Text style={styles.signal}>{answer.recordedSignal}</Text>
    </View>
  );
}

function SpendingAnswerBubble({ answer }: { answer: LucyAnswer }) {
  const categories = answer.spendingCategories ?? [];
  const expenses = answer.expenses ?? [];
  return (
    <View style={[styles.bubble, styles.lucyBubble]}>
      <Text style={styles.responseLabel}>LUCY INSIGHT</Text>
      <Text style={styles.answerTitle}>{answer.title}</Text>
      <Text style={styles.answerMessage}>{answer.message}</Text>
      {categories.length ? <Text style={styles.section}>By Category</Text> : null}
      {categories.map((category) => (
        <View style={styles.row} key={category.category}>
          <Text style={styles.rowText}>{category.category}</Text>
          <Text style={styles.amount}>{category.total.toFixed(2)}</Text>
        </View>
      ))}
      {expenses.length ? <Text style={styles.section}>Remembered Payments</Text> : null}
      {expenses.map((expense) => (
        <View style={styles.row} key={expense.id}>
          <Text style={styles.rowText}>{protectedPreview(expense.description)}</Text>
          <Text style={styles.amount}>{typeof expense.amount === 'number' ? expense.amount.toFixed(2) : '-'}</Text>
        </View>
      ))}
      {!expenses.length ? <Text style={styles.emptySection}>Capture a payment and I will start building this view.</Text> : null}
      <Text style={styles.signal}>{answer.recordedSignal}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  heading: { marginBottom: 12 },
  headingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  headingActions: { flexDirection: 'row', gap: 7 },
  title: { fontSize: 30, letterSpacing: -0.8, fontWeight: '700', color: LUCY_COLORS.textDark },
  subtitle: { color: LUCY_COLORS.textMuted, fontSize: 14, marginTop: 4 },
  actionButton: { borderWidth: 1, borderColor: LUCY_COLORS.border, backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 17, paddingVertical: 8, paddingHorizontal: 12 },
  actionText: { color: LUCY_COLORS.primaryGlow, fontWeight: '700', fontSize: 12 },
  conversation: { flex: 1 },
  thread: { paddingBottom: 12, gap: 10 },
  bubble: { maxWidth: '94%', padding: 14, borderRadius: 19, borderWidth: 1 },
  lucyBubble: { alignSelf: 'flex-start', backgroundColor: LUCY_COLORS.surfaceRaised, borderColor: LUCY_COLORS.border, borderBottomLeftRadius: 5 },
  userBubble: { alignSelf: 'flex-end', backgroundColor: LUCY_COLORS.primarySoft, borderColor: '#62311C', borderBottomRightRadius: 5 },
  lucyText: { color: LUCY_COLORS.textDark, fontSize: 14, lineHeight: 20 },
  userText: { color: LUCY_COLORS.textDark, fontSize: 14, lineHeight: 20 },
  suggestion: { backgroundColor: LUCY_COLORS.surface, borderWidth: 1, borderColor: LUCY_COLORS.border, borderRadius: 17, padding: 13, marginTop: 2 },
  suggestionLabel: { color: LUCY_COLORS.primaryGlow, fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 7 },
  suggestionText: { color: LUCY_COLORS.textDark, fontSize: 13, lineHeight: 19 },
  thinking: { color: LUCY_COLORS.textMuted, fontSize: 14 },
  responseLabel: { color: LUCY_COLORS.primaryGlow, fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 7 },
  answerTitle: { color: LUCY_COLORS.textDark, fontSize: 18, fontWeight: '700', marginBottom: 6 },
  answerMessage: { color: LUCY_COLORS.textMuted, fontSize: 14, marginBottom: 10 },
  tipList: { gap: 8, marginBottom: 12 },
  tipItem: { color: LUCY_COLORS.textDark, fontSize: 13, lineHeight: 20, paddingLeft: 4 },
  tipHint: { color: LUCY_COLORS.textSubtle, fontSize: 12, lineHeight: 18, fontStyle: 'italic' },
  section: { color: LUCY_COLORS.primaryGlow, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', marginTop: 8, marginBottom: 7 },
  emptySection: { color: LUCY_COLORS.textMuted, fontSize: 13, paddingVertical: 7 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: LUCY_COLORS.border },
  rowText: { flex: 1, color: LUCY_COLORS.textDark, fontSize: 14, lineHeight: 19 },
  amount: { color: LUCY_COLORS.textDark, fontSize: 14, lineHeight: 19, fontWeight: '600' },
  deadline: { flex: 1 },
  time: { color: LUCY_COLORS.textMuted, fontSize: 12, marginTop: 4 },
  sourceCard: { backgroundColor: LUCY_COLORS.surface, borderRadius: 13, borderWidth: 1, borderColor: LUCY_COLORS.border, padding: 11, marginBottom: 7 },
  sourceTitle: { color: LUCY_COLORS.textDark, fontSize: 13, lineHeight: 19, fontWeight: '700' },
  sourceAction: { color: LUCY_COLORS.textMuted, fontSize: 12, lineHeight: 18, marginTop: 6 },
  signal: { color: LUCY_COLORS.textMuted, fontSize: 12, marginTop: 12, lineHeight: 18 },
  historyCard: { backgroundColor: LUCY_COLORS.surfaceRaised, borderWidth: 1, borderColor: LUCY_COLORS.border, borderRadius: 17, padding: 14, gap: 8 },
  historyTitle: { color: LUCY_COLORS.textDark, fontSize: 15, lineHeight: 21, fontWeight: '600' },
  historyMeta: { color: LUCY_COLORS.textMuted, fontSize: 12 },
  emptyHistory: { color: LUCY_COLORS.textMuted, backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 16, padding: 16 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 9, paddingTop: 8 },
  input: { flex: 1, minHeight: 48, maxHeight: 108, borderRadius: 24, backgroundColor: LUCY_COLORS.surfaceRaised, borderColor: LUCY_COLORS.border, borderWidth: 1, color: LUCY_COLORS.textDark, paddingHorizontal: 16, paddingTop: 13, paddingBottom: 12, fontSize: 15, textAlignVertical: 'top' },
  send: { height: 48, borderRadius: 24, backgroundColor: LUCY_COLORS.primary, paddingHorizontal: 19, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.4 },
  sendText: { color: LUCY_COLORS.white, fontSize: 14, fontWeight: '700' },
});
