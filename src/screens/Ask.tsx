import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
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
import { executeActions, summarizeAction, type LucyAction } from '../processing/lucyActions';
import { isInvalidDeadline, isInvalidPendingTask } from '../processing/artifactCleanup';
import { protectedPreview } from '../processing/privacy';
import { enqueueTranscript } from '../processing/extract';
import { getStoredInsights, generateDailyInsights, type GeneratedInsight } from '../processing/insightEngine';
import { detectAutomationIntent, executeAction, type ExtractedAction } from '../processing/automationEngine';

const exampleQuestion = 'What tasks and deadlines need my attention today?';

/** Compact animated dots — replaces "Looking through memory..." static text. */
function OrganizingDotsInline() {
  const dots = [useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current];
  useEffect(() => {
    const anims = dots.map((a, i) =>
      Animated.loop(Animated.sequence([
        Animated.delay(i * 180),
        Animated.timing(a, { toValue: 1, duration: 400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(a, { toValue: 0, duration: 400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.delay((2 - i) * 180),
      ]))
    );
    Animated.parallel(anims).start();
    return () => anims.forEach((a) => a.stop());
  }, []);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      {dots.map((a, i) => (
        <Animated.View key={i} style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: LUCY_COLORS.primary, opacity: a.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }), transform: [{ scale: a.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1.2] }) }] }} />
      ))}
      <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 12, marginLeft: 4 }}>Searching your memory</Text>
    </View>
  );
}
const QUICK_QUESTIONS = [
  'What do I need to do today?',
  'What have I been stressed about lately?',
  'Who should I follow up with?',
  'What ideas have I had recently?',
  'How has my mood been this week?',
  'What expenses did I capture?',
];

type ChatMessage =
  | { id: string; role: 'lucy'; text: string; answer?: undefined }
  | { id: string; role: 'lucy'; text?: undefined; answer: LucyAnswer }
  | { id: string; role: 'user'; text: string; answer?: undefined };

const welcomeMessage: ChatMessage = {
  id: 'welcome',
  role: 'lucy',
  text: 'Ask about today, or name a project, area, or person to explore connected memory. I answer on this device.',
};

export function AskScreen({ initialQuestion }: { initialQuestion?: string } = {}) {
  const [question, setQuestion] = useState(initialQuestion ?? '');
  const [messages, setMessages] = useState<ChatMessage[]>([welcomeMessage]);
  const [asking, setAsking] = useState(false);
  const [threadId, setThreadId] = useState<number>();
  const [view, setView] = useState<'new' | 'history' | 'insights' | 'thread'>('insights');
  const [history, setHistory] = useState<AskThreadSummaryRow[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const [insights, setInsights] = useState<GeneratedInsight[]>([]);
  const [expandedInsight, setExpandedInsight] = useState<number | null>(null);
  const [loadingInsights, setLoadingInsights] = useState(false);
  const [pendingAction, setPendingAction] = useState<ExtractedAction | null>(null);
  const [executingAction, setExecutingAction] = useState(false);
  const conversationRef = useRef<ScrollView>(null);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, (e) => setKeyboardOffset(e.endCoordinates.height));
    const hide = Keyboard.addListener(hideEvent, () => setKeyboardOffset(0));
    return () => { show.remove(); hide.remove(); };
  }, []);

  // Load insights on mount since it's the default view
  useEffect(() => { void loadInsights(); }, []);

  function scrollToLatest() {
    setTimeout(() => conversationRef.current?.scrollToEnd({ animated: true }), 20);
  }

  function startNewChat() {
    setView('new');
    setThreadId(undefined);
    setQuestion('');
    setMessages([welcomeMessage]);
  }

  const loadInsights = async () => {
    setLoadingInsights(true);
    try {
      const db = await getDatabase();
      let stored = await getStoredInsights(db);

      // Always prepend HealthKit insights (real-time steps / sleep / HR)
      const { generateHealthInsights } = await import('../processing/healthInsights');
      const healthInsights = await generateHealthInsights().catch(() => [] as typeof stored);

      if (stored.length === 0) {
        // Also add device intelligence as insights
        const { generateDeviceIntelligence } = await import('../processing/deviceInsights');
        const deviceReport = await generateDeviceIntelligence().catch(() => null);
        if (deviceReport) {
          const deviceInsights = [
            { question: 'What are my capture habits this week?', answer: deviceReport.captureRhythm, category: 'habits' as const, generatedAt: new Date().toISOString() },
            { question: 'What does my battery pattern reveal?', answer: deviceReport.batteryPattern, category: 'device' as const, generatedAt: new Date().toISOString() },
            { question: 'How does my mood connect to my activity?', answer: deviceReport.moodCorrelation, category: 'wellbeing' as const, generatedAt: new Date().toISOString() },
            { question: 'What\'s the most important thing I should notice?', answer: deviceReport.topInsight, category: 'habits' as const, generatedAt: new Date().toISOString() },
          ];
          stored = [...deviceInsights, ...stored];
        }
        if (stored.length === 0) {
          const generated = await generateDailyInsights(db);
          stored = generated;
        }
      }
      // Dedup by question similarity before combining
      const seenQuestions = new Set<string>();
      const dedup = (list: typeof stored) => list.filter((ins) => {
        const key = ins.question.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);
        if (seenQuestions.has(key)) return false;
        seenQuestions.add(key);
        return true;
      });
      setInsights([...dedup(healthInsights), ...dedup(stored)]);
    } finally {
      setLoadingInsights(false);
    }
  };

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
    if (!trimmed || asking) return;

    // Check for automation intent FIRST (before sending to LLM)
    const autoAction = detectAutomationIntent(trimmed);
    if (autoAction && autoAction.confidence >= 0.85) {
      setQuestion('');
      setPendingAction(autoAction);
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
      const captureCallback = async (text: string) => {
        await enqueueTranscript(text, 'text', false);
      };
      // Build conversation history so follow-ups ("yes", "do that") have context.
      const history = messages
        .map((m) => ({
          role: m.role === 'user' ? ('user' as const) : ('lucy' as const),
          content: m.role === 'user' ? (m.text ?? '') : (m.answer?.llmResponse ?? m.answer?.message ?? m.text ?? ''),
        }))
        .filter((h) => h.content.trim().length > 0)
        .slice(-8);
      const answer = await askLucy(trimmed, captureCallback, history);
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
            <TouchableOpacity
              style={[styles.actionButton, view === 'insights' && { backgroundColor: 'rgba(255,140,66,0.15)' }]}
              onPress={() => { setView('insights'); void loadInsights(); }}
            >
              <Text style={[styles.actionText, view === 'insights' && { color: '#FF8C42' }]}>✦ Insights</Text>
            </TouchableOpacity>
          </View>
        </View>
        <Text style={styles.subtitle}>{view === 'history' ? 'Past conversations, stored privately on this device.' : 'Private answers from your memory, on this device.'}</Text>
      </View>
      {/* Automation Action Confirmation Card */}
      {pendingAction ? (
        <View style={styles.actionConfirmCard}>
          <Text style={styles.actionConfirmLabel}>LUCY can do this</Text>
          <Text style={styles.actionConfirmTitle}>{pendingAction.displayText}</Text>
          <View style={styles.actionConfirmButtons}>
            <TouchableOpacity
              style={[styles.actionConfirmBtn, executingAction && { opacity: 0.5 }]}
              disabled={executingAction}
              onPress={async () => {
                setExecutingAction(true);
                const result = await executeAction(pendingAction);
                setExecutingAction(false);
                setPendingAction(null);
                // Add result as a LUCY message
                const messageId = `action-${Date.now()}`;
                setMessages((prev) => [...prev, {
                  id: messageId,
                  role: 'lucy',
                  text: result.success ? `Done — ${result.message}` : `Hmm, ${result.message}`,
                }]);
              }}
            >
              <Text style={styles.actionConfirmBtnText}>{executingAction ? '...' : pendingAction.confirmText}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionCancelBtn} onPress={() => setPendingAction(null)}>
              <Text style={styles.actionCancelText}>Not now</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {view === 'insights' ? (
        <InsightsView
          insights={insights}
          loading={loadingInsights}
          expanded={expandedInsight}
          onToggle={(i) => setExpandedInsight(expandedInsight === i ? null : i)}
          onAskThis={(q) => { setView('new'); setQuestion(q); }}
          onOpenChat={() => { setView('new'); setQuestion(''); }}
        />
      ) : view === 'history' ? (
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
              <View style={{ gap: 8, paddingTop: 8 }}>
                <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 10, fontWeight: '800', letterSpacing: 1.2, paddingHorizontal: 4 }}>QUICK QUESTIONS</Text>
                {QUICK_QUESTIONS.map((q) => (
                  <TouchableOpacity
                    key={q}
                    style={styles.suggestion}
                    onPress={() => { setQuestion(q); void ask(q); }}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.suggestionText}>{q}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
            {asking ? (
              <View style={[styles.bubble, styles.lucyBubble]}>
                <OrganizingDotsInline />
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

const CATEGORY_META: Record<string, { color: string; icon: string; label: string }> = {
  habits:        { color: '#FF8C42', icon: '◈', label: 'Habit' },
  relationships: { color: '#60A5FA', icon: '◉', label: 'People' },
  progress:      { color: '#4ADE80', icon: '▲', label: 'Progress' },
  wellbeing:     { color: '#F472B6', icon: '♡', label: 'Health' },
  memory:        { color: '#FFA05C', icon: '⟳', label: 'Memory' },
  device:        { color: '#A78BFA', icon: '⌘', label: 'Device' },
};

function InsightCard({
  insight,
  index,
  expanded,
  onToggle,
  onAskThis,
}: {
  insight: GeneratedInsight;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  onAskThis: (q: string) => void;
}) {
  const meta = CATEGORY_META[insight.category] ?? { color: LUCY_COLORS.primary, icon: '✦', label: 'Insight' };
  const expandAnim = useRef(new Animated.Value(0)).current;
  const mountAnim = useRef(new Animated.Value(0)).current;
  const chevronAnim = useRef(new Animated.Value(0)).current;

  // Staggered mount animation
  useEffect(() => {
    const timer = setTimeout(() => {
      Animated.spring(mountAnim, {
        toValue: 1,
        friction: 8,
        tension: 60,
        useNativeDriver: true,
      }).start();
    }, index * 80);
    return () => clearTimeout(timer);
  }, []);

  // Expand / collapse
  useEffect(() => {
    Animated.parallel([
      Animated.timing(expandAnim, {
        toValue: expanded ? 1 : 0,
        duration: 280,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.timing(chevronAnim, {
        toValue: expanded ? 1 : 0,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start();
  }, [expanded]);

  const answerMaxHeight = expandAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 300] });
  const answerOpacity   = expandAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 0, 1] });
  const chevronRotate   = chevronAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });

  return (
    <Animated.View
      style={[
        icStyles.card,
        {
          borderLeftColor: meta.color,
          opacity: mountAnim,
          transform: [
            { translateY: mountAnim.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) },
            { scale: mountAnim.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) },
          ],
        },
      ]}
    >
      <TouchableOpacity onPress={onToggle} activeOpacity={0.75} style={icStyles.header}>
        <View style={[icStyles.iconBadge, { backgroundColor: meta.color + '20' }]}>
          <Text style={[icStyles.icon, { color: meta.color }]}>{meta.icon}</Text>
        </View>
        <View style={icStyles.headerText}>
          <Text style={[icStyles.category, { color: meta.color }]}>{meta.label.toUpperCase()}</Text>
          <Text style={icStyles.question}>{insight.question}</Text>
        </View>
        <Animated.Text style={[icStyles.chevron, { transform: [{ rotate: chevronRotate }] }]}>▾</Animated.Text>
      </TouchableOpacity>

      <Animated.View style={{ maxHeight: answerMaxHeight, opacity: answerOpacity, overflow: 'hidden' }}>
        <View style={icStyles.answerBody}>
          <View style={[icStyles.answerAccent, { backgroundColor: meta.color }]} />
          <View style={{ flex: 1, gap: 12 }}>
            <Text style={icStyles.answerText}>{insight.answer}</Text>
            <TouchableOpacity
              style={[icStyles.askBtn, { borderColor: meta.color + '66' }]}
              onPress={() => onAskThis(insight.question)}
            >
              <Text style={[icStyles.askBtnText, { color: meta.color }]}>Ask follow-up →</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

function InsightsView({
  insights,
  loading,
  expanded,
  onToggle,
  onAskThis,
  onOpenChat,
}: {
  insights: GeneratedInsight[];
  loading: boolean;
  expanded: number | null;
  onToggle: (i: number) => void;
  onAskThis: (q: string) => void;
  onOpenChat: () => void;
}) {
  const healthInsights = insights.filter((i) => i.category === 'wellbeing' && i.generatedAt);
  const otherInsights  = insights.filter((i) => !(i.category === 'wellbeing' && healthInsights.includes(i)));

  return (
    <ScrollView
      style={styles.conversation}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 48 }}
    >
      <View style={styles.insightsHeader}>
        <Text style={styles.insightsTitle}>What LUCY noticed</Text>
        <Text style={styles.insightsSub}>Tap any card to reveal the insight.</Text>
        <TouchableOpacity
          style={styles.insightsAskBtn}
          onPress={onOpenChat}
        >
          <Text style={styles.insightsAskBtnText}>✦ Ask LUCY something →</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <Text style={{ color: LUCY_COLORS.textSubtle, textAlign: 'center', marginTop: 40, fontSize: 14 }}>LUCY is thinking...</Text>
      ) : insights.length === 0 ? (
        <View style={{ padding: 20, gap: 16 }}>
          <Text style={{ color: LUCY_COLORS.textSubtle, textAlign: 'center', fontSize: 14, lineHeight: 22 }}>
            No insights generated yet.
          </Text>
          <View style={{ backgroundColor: LUCY_COLORS.primarySoft, borderRadius: 14, padding: 16 }}>
            <Text style={{ color: LUCY_COLORS.primaryGlow, fontSize: 13, fontWeight: '700', marginBottom: 4 }}>To generate insights:</Text>
            <Text style={{ color: LUCY_COLORS.textMuted, fontSize: 13, lineHeight: 21 }}>
              1. Enable Remote Intelligence in Settings{'\n'}
              2. Add your OpenAI API key{'\n'}
              3. Capture a few thoughts — LUCY generates them automatically
            </Text>
          </View>
        </View>
      ) : (
        <>
          {healthInsights.length > 0 ? (
            <>
              <Text style={icStyles.sectionLabel}>♡  Health & Activity</Text>
              {healthInsights.map((insight, i) => (
                <InsightCard
                  key={`health-${i}`}
                  insight={insight}
                  index={i}
                  expanded={expanded === insights.indexOf(insight)}
                  onToggle={() => onToggle(insights.indexOf(insight))}
                  onAskThis={onAskThis}
                />
              ))}
            </>
          ) : null}

          {otherInsights.length > 0 ? (
            <>
              {healthInsights.length > 0 ? <Text style={[icStyles.sectionLabel, { marginTop: 8 }]}>✦  Memory & Patterns</Text> : null}
              {otherInsights.map((insight, i) => (
                <InsightCard
                  key={`insight-${i}`}
                  insight={insight}
                  index={healthInsights.length + i}
                  expanded={expanded === insights.indexOf(insight)}
                  onToggle={() => onToggle(insights.indexOf(insight))}
                  onAskThis={onAskThis}
                />
              ))}
            </>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

const icStyles = StyleSheet.create({
  sectionLabel: {
    fontSize: 11, fontWeight: '800', letterSpacing: 1.4, color: LUCY_COLORS.textSubtle,
    textTransform: 'uppercase', marginBottom: 10, marginTop: 4,
  },
  card: {
    backgroundColor: LUCY_COLORS.surfaceRaised,
    borderRadius: 18,
    borderLeftWidth: 3,
    marginBottom: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: LUCY_COLORS.border,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 16,
  },
  iconBadge: {
    width: 36, height: 36, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  icon: { fontSize: 17, fontWeight: '800' },
  headerText: { flex: 1, gap: 3 },
  category: {
    fontSize: 10, fontWeight: '800', letterSpacing: 1.2,
  },
  question: {
    fontSize: 15, fontWeight: '600', color: LUCY_COLORS.textDark, lineHeight: 21,
  },
  chevron: {
    fontSize: 18, color: LUCY_COLORS.textSubtle, flexShrink: 0,
  },
  answerBody: {
    flexDirection: 'row', gap: 12,
    paddingHorizontal: 16, paddingBottom: 18,
  },
  answerAccent: {
    width: 2, borderRadius: 1, alignSelf: 'stretch', flexShrink: 0, opacity: 0.6,
  },
  answerText: {
    fontSize: 14, color: LUCY_COLORS.textMuted, lineHeight: 22,
  },
  askBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 8, borderWidth: 1,
  },
  askBtnText: { fontSize: 13, fontWeight: '600' },
});

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

function ActionPlanCard({ actions }: { actions: LucyAction[] }) {
  const [state, setState] = useState<'idle' | 'applying' | 'done'>('idle');
  const [resultText, setResultText] = useState('');

  const apply = async () => {
    setState('applying');
    try {
      const { applied, summary } = await executeActions(actions);
      setResultText(applied > 0 ? `✓ ${summary} Open Tasks to see the changes.` : 'Nothing was changed.');
      setState('done');
    } catch {
      setResultText('Could not apply the changes.');
      setState('done');
    }
  };

  return (
    <View style={styles.planCard}>
      <Text style={styles.planTitle}>Proposed changes</Text>
      {actions.map((a, i) => (
        <View key={i} style={styles.planRow}>
          <Text style={styles.planBullet}>•</Text>
          <Text style={styles.planText}>{summarizeAction(a)}</Text>
        </View>
      ))}
      {state === 'done' ? (
        <Text style={styles.planDone}>{resultText}</Text>
      ) : (
        <TouchableOpacity
          style={[styles.planApplyBtn, state === 'applying' && { opacity: 0.6 }]}
          disabled={state === 'applying'}
          onPress={() => void apply()}
        >
          <Text style={styles.planApplyText}>{state === 'applying' ? 'Applying…' : 'Apply changes'}</Text>
        </TouchableOpacity>
      )}
    </View>
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
  if (answer.answerKind === 'llm') {
    return (
      <View style={[styles.bubble, styles.lucyBubble]}>
        <Text style={styles.responseLabel}>LUCY</Text>
        <Text style={styles.llmResponse}>{answer.llmResponse}</Text>
        {answer.proposedActions && answer.proposedActions.length > 0 ? (
          <ActionPlanCard actions={answer.proposedActions} />
        ) : null}
        {answer.citedSources && answer.citedSources.length > 0 ? (
          <View style={styles.sourcesSection}>
            <Text style={styles.sourcesLabel}>From your memory</Text>
            {answer.citedSources.map((src) => (
              <View key={src.captureId} style={styles.sourceChip}>
                <Text style={styles.citedSourceTitle} numberOfLines={1}>{src.title}</Text>
                <Text style={styles.sourceSnippet} numberOfLines={1}>{src.snippet}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    );
  }
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
  suggestion: { backgroundColor: LUCY_COLORS.surfaceRaised, borderWidth: 1, borderColor: LUCY_COLORS.border, borderTopColor: '#3A3028', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11, marginTop: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.18, shadowRadius: 3, elevation: 2 },
  suggestionLabel: { color: LUCY_COLORS.primaryGlow, fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 7 },
  suggestionText: { color: LUCY_COLORS.textDark, fontSize: 13, lineHeight: 19 },
  thinking: { color: LUCY_COLORS.textMuted, fontSize: 14 },
  responseLabel: { color: LUCY_COLORS.primary, fontSize: 11, fontWeight: '800', letterSpacing: 0.8, marginBottom: 8 },  // was invisible at 10px
  answerTitle: { color: LUCY_COLORS.textDark, fontSize: 18, fontWeight: '700', marginBottom: 6 },
  answerMessage: { color: LUCY_COLORS.textMuted, fontSize: 14, marginBottom: 10 },
  tipList: { gap: 8, marginBottom: 12 },
  tipItem: { color: LUCY_COLORS.textDark, fontSize: 13, lineHeight: 20, paddingLeft: 4 },
  tipHint: { color: LUCY_COLORS.textSubtle, fontSize: 12, lineHeight: 18, fontStyle: 'italic' },
  actionConfirmCard: { margin: 16, backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,140,66,0.3)', padding: 20, gap: 12 },
  actionConfirmLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.5, color: LUCY_COLORS.primary, textTransform: 'uppercase' },
  actionConfirmTitle: { fontSize: 18, fontWeight: '800', color: LUCY_COLORS.textDark, lineHeight: 25 },
  actionConfirmButtons: { flexDirection: 'row', gap: 10, marginTop: 4 },
  actionConfirmBtn: { flex: 2, backgroundColor: LUCY_COLORS.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  actionConfirmBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  actionCancelBtn: { flex: 1, borderWidth: 1, borderColor: LUCY_COLORS.border, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  actionCancelText: { color: LUCY_COLORS.textMuted, fontSize: 15, fontWeight: '600' },
  insightsHeader: { marginBottom: 16 },
  insightsTitle: { color: LUCY_COLORS.textDark, fontSize: 20, fontWeight: '800', marginBottom: 6 },
  insightsSub: { color: LUCY_COLORS.textMuted, fontSize: 13, lineHeight: 20, marginBottom: 12 },
  insightsAskBtn: { alignSelf: 'flex-start', backgroundColor: LUCY_COLORS.primarySoft, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 9, borderWidth: 1, borderColor: LUCY_COLORS.primary + '55' },
  insightsAskBtnText: { color: LUCY_COLORS.primary, fontSize: 14, fontWeight: '700' },
  insightCard: { backgroundColor: LUCY_COLORS.surfaceRaised, borderWidth: 1, borderColor: LUCY_COLORS.border, borderRadius: 16, marginBottom: 10, overflow: 'hidden' },
  insightCardTop: { flexDirection: 'row', alignItems: 'flex-start', padding: 16, gap: 12 },
  insightDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5, flexShrink: 0 },
  insightQuestion: { flex: 1, color: LUCY_COLORS.textDark, fontSize: 14, fontWeight: '600', lineHeight: 21 },
  insightChevron: { color: LUCY_COLORS.textSubtle, fontSize: 10, marginTop: 4 },
  insightAnswer: { borderTopWidth: 1, borderTopColor: LUCY_COLORS.divider, padding: 16, gap: 12 },
  insightAnswerText: { color: LUCY_COLORS.textDark, fontSize: 14, lineHeight: 22 },
  insightAskBtn: { alignSelf: 'flex-start', backgroundColor: LUCY_COLORS.primarySoft, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 },
  insightAskBtnText: { color: LUCY_COLORS.primaryGlow, fontSize: 12, fontWeight: '700' },
  llmResponse: { color: LUCY_COLORS.textDark, fontSize: 15, lineHeight: 23, marginBottom: 10 },
  planCard: { backgroundColor: LUCY_COLORS.surface, borderRadius: 14, borderWidth: 1, borderColor: LUCY_COLORS.primary + '44', padding: 14, marginBottom: 10, gap: 6 },
  planTitle: { color: LUCY_COLORS.primaryGlow, fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 },
  planRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  planBullet: { color: LUCY_COLORS.primary, fontSize: 14, fontWeight: '800' },
  planText: { color: LUCY_COLORS.textDark, fontSize: 14, flex: 1, lineHeight: 20 },
  planApplyBtn: { backgroundColor: LUCY_COLORS.primary, borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginTop: 8 },
  planApplyText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  planDone: { color: LUCY_COLORS.success, fontSize: 13, fontWeight: '700', marginTop: 8, lineHeight: 19 },
  sourcesSection: { borderTopWidth: 1, borderTopColor: LUCY_COLORS.divider, marginTop: 4, paddingTop: 12, gap: 6 },
  sourcesLabel: { color: LUCY_COLORS.primary, fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 },
  sourceChip: { backgroundColor: LUCY_COLORS.surface, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: LUCY_COLORS.border },  // more separated from answer
  citedSourceTitle: { color: LUCY_COLORS.textDark, fontSize: 12, fontWeight: '700' },
  sourceSnippet: { color: LUCY_COLORS.textSubtle, fontSize: 11, marginTop: 1 },
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
  input: { flex: 1, minHeight: 52, maxHeight: 120, borderRadius: 26, backgroundColor: LUCY_COLORS.surfaceRaised, borderColor: LUCY_COLORS.border, borderWidth: 1, color: LUCY_COLORS.textDark, paddingHorizontal: 18, paddingTop: 14, paddingBottom: 14, fontSize: 15, textAlignVertical: 'top' },  // taller, easier to tap
  send: { height: 48, borderRadius: 24, backgroundColor: LUCY_COLORS.primary, paddingHorizontal: 19, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.4 },
  sendText: { color: LUCY_COLORS.white, fontSize: 14, fontWeight: '700' },
});
