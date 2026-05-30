import { useEffect, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { PrivacyBadge } from '../components/PrivacyBadge';
import { LUCY_COLORS } from '../config/colors';
import { getDatabase } from '../db';
import { captureStatus, listCaptureUpdates, listRecentCaptures, type CaptureRow } from '../db/captures';
import { answerContextRequest, listOpenContextRequests, type ContextRequestRow } from '../db/contextRequests';
import { listExpenses, type ExpenseRow } from '../db/expenses';
import { listIdeas, type IdeaRow } from '../db/ideas';
import { listOpenLoops, resolveOpenLoop, type OpenLoopRow } from '../db/openLoops';
import { listFollowUps, resolveFollowUp, type FollowUpRow } from '../db/followUps';
// Music detection removed
import { listReminders, type ReminderRow } from '../db/reminders';
import { listTodos, type TodoRow } from '../db/todos';
import { protectedPreview } from '../processing/privacy';
import { organizeMemory } from '../processing/organizer';
import { enqueueTranscript } from '../processing/extract';
import { archiveTodo } from '../db/todos';

type ViewMode = 'Focus Now' | 'Timeline' | 'Brain';
type LibraryTab = 'Todos' | 'Ideas' | 'Expenses' | 'People';

function displayTimestamp(value: string): string {
  return new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`).toLocaleString();
}

// Parse structured memory text into clean bullet points, skipping metadata lines.
function extractKeyPoints(structured: string): string[] {
  const skip = new Set(['title', 'type', 'summary']);
  return structured
    .split('\n')
    .map((line) => {
      const colon = line.indexOf(':');
      if (colon === -1) return null;
      const label = line.slice(0, colon).trim().toLowerCase();
      if (skip.has(label)) return null;
      const value = line.slice(colon + 1).trim();
      if (!value) return null;
      return `· ${value}`;
    })
    .filter((x): x is string => x !== null)
    .slice(0, 4);
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

export function DashboardScreen({ refreshToken }: { refreshToken: number }) {
  const [view, setView] = useState<ViewMode>('Timeline');
  const [tab, setTab] = useState<LibraryTab>('Todos');
  const [todos, setTodos] = useState<TodoRow[]>([]);
  const [ideas, setIdeas] = useState<IdeaRow[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [reminders, setReminders] = useState<ReminderRow[]>([]);
  const [captures, setCaptures] = useState<CaptureRow[]>([]);
  const [updates, setUpdates] = useState<Record<number, CaptureRow[]>>({});
  const [contextRequests, setContextRequests] = useState<ContextRequestRow[]>([]);
  const [openLoops, setOpenLoops] = useState<OpenLoopRow[]>([]);
  const [followUps, setFollowUps] = useState<FollowUpRow[]>([]);
  const [moodTrend, setMoodTrend] = useState<{ dominant: string; positiveRatio: number; recentTones: string[] }>({ dominant: 'neutral', positiveRatio: 0.5, recentTones: [] });
  const [onThisDay, setOnThisDay] = useState<import('../processing/onThisDay').OnThisDayMemory[]>([]);
  const [moodsByCapture, setMoodsByCapture] = useState<Record<number, string>>({});
  const [contextRefresh, setContextRefresh] = useState(0);

  useEffect(() => {
    void (async () => {
      const db = await getDatabase();
      const results = await Promise.all([
        listTodos(db),
        listIdeas(db),
        listExpenses(db),
        listReminders(db),
        listRecentCaptures(db, 12),
        listOpenContextRequests(db),
        listOpenLoops(db),
        listFollowUps(db),
      ]);
      setTodos(results[0]);
      setIdeas(results[1]);
      setExpenses(results[2]);
      setReminders(results[3]);
      setCaptures(results[4]);
      setContextRequests(results[5]);
      setOpenLoops(results[6]);
      setFollowUps(results[7]);
      try {
        const { getMoodTrend } = await import('../processing/temporalEngine');
        setMoodTrend(await getMoodTrend(db, 7));
      } catch { /* non-critical */ }
      try {
        const { getOnThisDayMemories } = await import('../processing/onThisDay');
        setOnThisDay(await getOnThisDayMemories(db));
      } catch { /* non-critical */ }
      try {
        const rows = await db.getAllAsync<{ capture_id: number; tone: string }>(
          'SELECT capture_id, tone FROM mood_entries ORDER BY created_at DESC',
        );
        const map: Record<number, string> = {};
        for (const row of rows) {
          if (!map[row.capture_id]) map[row.capture_id] = row.tone; // most recent tone per capture
        }
        setMoodsByCapture(map);
      } catch { /* non-critical */ }
      const nextUpdates = await listCaptureUpdates(db, results[4].map((capture) => capture.id));
      setUpdates(groupUpdates(nextUpdates));
    })();
  }, [refreshToken, contextRefresh]);

  const pendingTodos = todos.filter((item) => item.status === 'pending');
  const focusTasks = pendingTodos.filter((item) => item.urgency === 'high').slice(0, 3);
  const displayTasks = focusTasks.length ? focusTasks : pendingTodos.slice(0, 3);
  const views: ViewMode[] = ['Timeline', 'Focus Now', 'Brain'];

  return (
    <View style={styles.container}>
      <Text style={styles.todayDate}>{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</Text>
      <Text style={styles.title}>Today</Text>
      <Text style={styles.subtitle}>What matters now, pulled from your memory.</Text>
      <View style={styles.viewNav}>
        {views.map((item) => (
          <TouchableOpacity key={item} style={[styles.viewTab, view === item && styles.activeView]} onPress={() => setView(item)}>
            <Text style={[styles.viewText, view === item && styles.activeViewText]}>{item}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {view === 'Focus Now' ? <NowView todos={displayTasks} reminders={reminders} captures={captures} contextCount={contextRequests.length} openLoops={openLoops} followUps={followUps} moodTrend={moodTrend} onThisDay={onThisDay} onOpenContext={() => {}} onLoopResolved={() => setContextRefresh((v) => v + 1)} /> : null}
      {view === 'Timeline' ? <TimelineView captures={captures} moodsByCapture={moodsByCapture} onFeedback={() => setContextRefresh((v) => v + 1)} onQueued={() => setContextRefresh((v) => v + 1)} /> : null}
      {view === 'Brain' ? (
        <LibraryView
          tab={tab}
          setTab={setTab}
          todos={todos}
          ideas={ideas}
          expenses={expenses}
        />
      ) : null}
    </View>
  );
}

function NowView({
  todos,
  reminders,
  captures,
  contextCount,
  openLoops,
  followUps,
  moodTrend,
  onThisDay,
  onOpenContext,
  onLoopResolved,
}: {
  todos: TodoRow[];
  reminders: ReminderRow[];
  captures: CaptureRow[];
  contextCount: number;
  openLoops: OpenLoopRow[];
  followUps: FollowUpRow[];
  moodTrend: { dominant: string; positiveRatio: number; recentTones: string[] };
  onThisDay: import('../processing/onThisDay').OnThisDayMemory[];
  onOpenContext: () => void;
  onLoopResolved: () => void;
}) {
  const moodEmoji: Record<string, string> = { positive: '😊', excited: '⚡', calm: '😌', neutral: '😐', stressed: '😤', frustrated: '😤', negative: '😔' };
  const moodColor: Record<string, string> = { positive: '#4ADE80', excited: '#FFA05C', calm: '#60A5FA', neutral: LUCY_COLORS.textSubtle, stressed: '#F59E0B', frustrated: '#FB7185', negative: '#FB7185' };
  const organizing = captures.filter((item) => captureStatus(item) !== 'complete').length;
  const scheduledReminders = reminders.filter((item) => Boolean(item.notification_id) && Boolean(item.remind_at));
  const unscheduledCount = reminders.length - scheduledReminders.length;

  const handleResolveLoop = async (id: number) => {
    const db = await getDatabase();
    await resolveOpenLoop(db, id);
    onLoopResolved();
  };

  const handleResolveFollowUp = async (id: number) => {
    const db = await getDatabase();
    await resolveFollowUp(db, id);
    onLoopResolved();
  };

  return (
    <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.tonight}>
        <Text style={styles.eyebrow}>TONIGHT</Text>
        <Text style={styles.tonightTitle}>
          {todos.length ? `${todos.length} priority item${todos.length === 1 ? '' : 's'} waiting` : 'Nothing urgent waiting'}
        </Text>
        <Text style={styles.tonightDetail}>
          {organizing ? `${organizing} capture${organizing === 1 ? '' : 's'} still organizing.` : 'Everything captured has been organized.'}
        </Text>
        {moodTrend.recentTones.length > 0 ? (
          <View style={styles.moodBar}>
            <Text style={[styles.moodLabel, { color: moodColor[moodTrend.dominant] ?? LUCY_COLORS.textSubtle }]}>
              {moodEmoji[moodTrend.dominant] ?? '😐'} {moodTrend.dominant} this week
            </Text>
            <View style={styles.moodDots}>
              {moodTrend.recentTones.slice(0, 7).map((tone, i) => (
                <View key={i} style={[styles.moodDot, { backgroundColor: moodColor[tone] ?? LUCY_COLORS.textSubtle }]} />
              ))}
            </View>
          </View>
        ) : null}
      </View>
      {onThisDay.length > 0 ? (
        <View style={styles.otdCard}>
          <Text style={styles.otdLabel}>On this day</Text>
          <Text style={styles.otdTitle}>
            {onThisDay[0].yearsAgo === 1 ? 'A year ago' : `${onThisDay[0].yearsAgo} years ago`} — {onThisDay[0].title}
          </Text>
          {onThisDay[0].snippet ? <Text style={styles.otdSnippet} numberOfLines={2}>{onThisDay[0].snippet}</Text> : null}
          {onThisDay.length > 1 ? (
            <Text style={styles.otdMore}>+ {onThisDay.length - 1} more from this day</Text>
          ) : null}
        </View>
      ) : null}
      {contextCount ? (
        <TouchableOpacity style={styles.contextPrompt} onPress={onOpenContext}>
          <Text style={styles.eyebrow}>NEEDS CONTEXT</Text>
          <Text style={styles.contextPromptTitle}>
            {contextCount} memory detail{contextCount === 1 ? '' : 's'} could become clearer
          </Text>
          <Text style={styles.tonightDetail}>Add a little context when you have time. LUCY keeps your original thought unchanged.</Text>
        </TouchableOpacity>
      ) : null}
      {followUps.length > 0 ? (
        <>
          <SectionTitle title="Follow-ups" />
          {followUps.map((item) => (
            <View style={styles.loopCard} key={item.id}>
              <Text style={styles.cardTitle}>{item.assignee ? `${item.assignee}: ` : ''}{protectedPreview(item.action)}</Text>
              <TouchableOpacity style={styles.resolveButton} onPress={() => void handleResolveFollowUp(item.id)}>
                <Text style={styles.resolveText}>Done</Text>
              </TouchableOpacity>
            </View>
          ))}
        </>
      ) : null}
      <SectionTitle title="Reminders" />
      {scheduledReminders.length ? scheduledReminders.map((item) => <ReminderCard item={item} key={item.id} />) : <EmptyLine text="No scheduled reminders yet." />}
      {unscheduledCount ? <Text style={styles.pendingHint}>{unscheduledCount} captured reminder{unscheduledCount === 1 ? '' : 's'} need a specific time.</Text> : null}
      <SectionTitle title="Focus" />
      {todos.length ? todos.map((item) => <Card key={item.id} title={item.task} detail={`${item.category} / ${item.urgency}`} privacy={item.privacy_level} />) : <EmptyLine text="Capture a task and it will appear here." />}
    </ScrollView>
  );
}

function NeedsContextView({
  requests,
  onAnswered,
}: {
  requests: ContextRequestRow[];
  onAnswered: () => void;
}) {
  const [answers, setAnswers] = useState<Record<number, string>>({});

  const rememberContext = async (request: ContextRequestRow) => {
    const answer = (answers[request.id] ?? '').trim();
    if (!answer) {
      return;
    }
    const db = await getDatabase();
    await answerContextRequest(db, request.id, answer);
    await organizeMemory(db, 'clarification');
    setAnswers((existing) => ({ ...existing, [request.id]: '' }));
    onAnswered();
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0}>
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}>
        <View style={styles.contextIntro}>
          <Text style={styles.eyebrow}>CONNECT</Text>
          <Text style={styles.tonightTitle}>Needs Context</Text>
          <Text style={styles.tonightDetail}>
            Optional questions that help LUCY connect memories more accurately. Your answers stay in encrypted local memory.
          </Text>
        </View>
        {requests.map((request) => (
          <View style={styles.contextCard} key={request.id}>
            <Text style={styles.contextLucyLabel}>hey, quick question —</Text>
            <Text style={styles.contextQuestion}>
              {request.question || 'Can you add any context that might help me organize this memory?'}
            </Text>
            {request.snippet ? (
              <Text style={styles.contextSnippet}>You said: "{protectedPreview(request.snippet)}"</Text>
            ) : null}
            <TextInput
              multiline
              placeholder="Your answer here..."
              placeholderTextColor={LUCY_COLORS.textSubtle}
              style={styles.contextInput}
              value={answers[request.id] ?? ''}
              onChangeText={(value) => setAnswers((existing) => ({ ...existing, [request.id]: value }))}
            />
            <TouchableOpacity
              style={[styles.contextButton, !(answers[request.id] ?? '').trim() && styles.contextButtonDisabled]}
              disabled={!(answers[request.id] ?? '').trim()}
              onPress={() => void rememberContext(request)}
            >
              <Text style={styles.contextButtonText}>Tell LUCY</Text>
            </TouchableOpacity>
          </View>
        ))}
        {!requests.length ? <EmptyLine text="Nothing needs clarification right now. LUCY will ask only when extra context can help." /> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Timeline View ─────────────────────────────────────────────────────────────

const MOOD_COLOR: Record<string, string> = {
  positive: '#4ADE80',
  excited:  '#FFA05C',
  calm:     '#60A5FA',
  neutral:  '#756F68',
  stressed: '#F59E0B',
  frustrated: '#FB7185',
  negative: '#FB7185',
};

function groupByDate(captures: CaptureRow[]): Array<{ dateLabel: string; dateKey: string; items: CaptureRow[] }> {
  const now = new Date();
  const today = now.toDateString();
  const yesterday = new Date(now.getTime() - 86400000).toDateString();
  const grouped: Record<string, CaptureRow[]> = {};

  for (const c of captures) {
    const d = new Date(c.created_at.includes('T') ? c.created_at : `${c.created_at.replace(' ', 'T')}Z`);
    const key = d.toDateString();
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(c);
  }

  return Object.entries(grouped)
    .sort(([a], [b]) => new Date(b).getTime() - new Date(a).getTime())
    .map(([key, items]) => ({
      dateKey: key,
      dateLabel: key === today ? 'Today' : key === yesterday ? 'Yesterday' : new Date(key).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }),
      items,
    }));
}

function TimelineView({
  captures,
  moodsByCapture,
  onFeedback,
  onQueued,
}: {
  captures: CaptureRow[];
  moodsByCapture: Record<number, string>;
  onFeedback: () => void;
  onQueued?: () => void;
}) {
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [feedbackTarget, setFeedbackTarget] = useState<CaptureRow | null>(null);
  const [feedbackText, setFeedbackText] = useState('');
  const [sending, setSending] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<CaptureRow[] | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [quickText, setQuickText] = useState('');
  const [quickSending, setQuickSending] = useState(false);
  const [quickAck, setQuickAck] = useState('');
  const [pendingAction, setPendingAction] = useState<import('../processing/automationEngine').ExtractedAction | null>(null);
  const [executingAction, setExecutingAction] = useState(false);
  const [menuTarget, setMenuTarget] = useState<CaptureRow | null>(null);

  const reprocessCapture = async (capture: CaptureRow) => {
    const db = await getDatabase();
    // Purge previously-extracted items first so reprocessing can't leave duplicates.
    const { resetCaptureForReprocess } = await import('../db/captures');
    await resetCaptureForReprocess(db, capture.id);
    onFeedback();
  };

  const confirmDeleteCapture = (capture: CaptureRow) => {
    Alert.alert(
      'Delete memory?',
      'This thought will be permanently removed from your timeline.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            const db = await getDatabase();
            const { deleteCaptureCompletely } = await import('../db/captures');
            await deleteCaptureCompletely(db, capture.id, 'deleted by user');
            // Rebuild the knowledge projection so the deleted memory leaves the Brain too.
            try {
              const { organizeMemory } = await import('../processing/organizer');
              await organizeMemory(db, 'after-delete');
            } catch { /* non-critical — derived rows are already purged */ }
            onFeedback();
          },
        },
      ],
    );
  };

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!query.trim()) { setSearchResults(null); return; }
    searchTimer.current = setTimeout(async () => {
      try {
        const { findSimilarCaptures } = await import('../processing/vectorSearch');
        const db = await getDatabase();
        const results = await findSimilarCaptures(db, query, 10, 0.1);
        setSearchResults(results.map((r) => r.capture));
      } catch { setSearchResults(null); }
    }, 300);
  };

  const displayCaptures = searchResults ?? captures;
  const groups = groupByDate(displayCaptures);

  const submitFeedback = async () => {
    if (!feedbackTarget || !feedbackText.trim()) return;
    setSending(true);
    try {
      const db = await getDatabase();
      // Append note to the SAME capture and re-queue — no new memory created
      await db.runAsync(
        `UPDATE captures SET
           raw_transcript = raw_transcript || '\n\n[Added context: ' || ? || ']',
           processed = 0, processing_error = NULL, attempt_count = 0,
           extracted_title = NULL, structured_text = NULL
         WHERE id = ?`,
        feedbackText.trim(), feedbackTarget.id,
      );
      setFeedbackTarget(null); setFeedbackText(''); onFeedback();
    } finally { setSending(false); }
  };

  const sendQuick = async () => {
    const t = quickText.trim();
    if (!t || quickSending) return;

    // Check for automation intent first
    const { detectAutomationIntent } = await import('../processing/automationEngine');
    const autoAction = detectAutomationIntent(t);
    if (autoAction && autoAction.confidence >= 0.8) {
      setQuickText('');
      setPendingAction(autoAction);
      // Still save the thought as a memory — a misfired detection must never lose it.
      void enqueueTranscript(t, 'text', false).then(() => onQueued?.()).catch(() => {});
      return;
    }

    setQuickSending(true);
    try {
      await enqueueTranscript(t, 'text', false);
      setQuickText('');
      setQuickAck('Got it ✓');
      setTimeout(() => setQuickAck(''), 2000);
      onQueued?.();
    } catch { /* non-critical */ } finally { setQuickSending(false); }
  };

  return (
    <>
      {/* Quick capture bar */}
      <View style={styles.tlQuickBar}>
        <TextInput
          style={styles.tlQuickInput}
          placeholder="Capture a thought..."
          placeholderTextColor={LUCY_COLORS.textSubtle}
          value={quickAck || quickText}
          onChangeText={setQuickText}
          editable={!quickAck}
          returnKeyType="send"
          onSubmitEditing={() => void sendQuick()}
          blurOnSubmit={false}
        />
        <TouchableOpacity
          style={[styles.tlQuickSend, (!quickText.trim() || quickSending) && { opacity: 0.4 }]}
          onPress={() => void sendQuick()}
          disabled={!quickText.trim() || quickSending}
        >
          <Text style={styles.tlQuickSendText}>{quickSending ? '...' : '→'}</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.searchBar}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search timeline..."
          placeholderTextColor={LUCY_COLORS.textSubtle}
          value={searchQuery}
          onChangeText={handleSearch}
        />
        {searchQuery ? (
          <TouchableOpacity onPress={() => { setSearchQuery(''); setSearchResults(null); }}>
            <Text style={styles.searchClear}>✕</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {groups.length === 0 ? (
          <EmptyLine text="Nothing captured yet. Your timeline will grow as you capture thoughts." />
        ) : groups.map((group) => (
          <View key={group.dateKey}>
            {/* Date header */}
            <View style={styles.tlDateHeader}>
              <Text style={styles.tlDateLabel}>{group.dateLabel}</Text>
              <View style={styles.tlDateLine} />
            </View>

            {/* Timeline items */}
            {group.items.map((item, idx) => {
              const tone = moodsByCapture[item.id] ?? 'neutral';
              const moodColor = MOOD_COLOR[tone] ?? LUCY_COLORS.textSubtle;
              const timeStr = new Date(
                item.created_at.includes('T') ? item.created_at : `${item.created_at.replace(' ', 'T')}Z`,
              ).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
              const isExpanded = expanded[item.id];
              const isLast = idx === group.items.length - 1;

              return (
                <TouchableOpacity
                  key={item.id}
                  style={styles.tlRow}
                  onPress={() => setExpanded((prev) => ({ ...prev, [item.id]: !prev[item.id] }))}
                  activeOpacity={0.8}
                >
                  {/* Time + spine */}
                  <View style={styles.tlLeft}>
                    <Text style={styles.tlTime}>{timeStr}</Text>
                    <View style={styles.tlSpineWrap}>
                      <View style={[styles.tlDot, { backgroundColor: moodColor, shadowColor: moodColor }]} />
                      {!isLast ? <View style={styles.tlLine} /> : null}
                    </View>
                  </View>

                  {/* Card */}
                  <View style={[styles.tlCard, isExpanded && styles.tlCardExpanded]}>
                    {/* Mood color accent bar */}
                    <View style={[styles.tlAccent, { backgroundColor: moodColor }]} />
                    <View style={styles.tlCardContent}>
                      {item.extracted_title ? (
                        // Extracted title — curated by LUCY
                        <Text style={styles.tlTitle} numberOfLines={isExpanded ? undefined : 2}>
                          {protectedPreview(item.extracted_title)}
                        </Text>
                      ) : item.processed === -1 ? (
                        // Failed / retrying — surface it instead of an endless "Organizing..."
                        <View style={{ gap: 4 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#F59E0B' }} />
                            <Text style={{ color: '#F59E0B', fontSize: 11, fontWeight: '700', letterSpacing: 0.5 }}>
                              Couldn't organize — tap ⋯ to retry
                            </Text>
                          </View>
                          {item.raw_transcript ? (
                            <Text style={{ color: LUCY_COLORS.textMuted, fontSize: 13, lineHeight: 18 }} numberOfLines={2}>
                              {item.raw_transcript.slice(0, 120)}
                            </Text>
                          ) : null}
                          {isExpanded && item.processing_error ? (
                            <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 11, fontStyle: 'italic' }} numberOfLines={3}>
                              {item.processing_error}
                            </Text>
                          ) : null}
                        </View>
                      ) : (
                        // Not yet processed — show "Organizing..." + brief snippet so user knows what it is
                        <View style={{ gap: 4 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: LUCY_COLORS.primary, opacity: 0.6 }} />
                            <Text style={{ color: LUCY_COLORS.primary, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 }}>
                              Organizing...
                            </Text>
                          </View>
                          {item.raw_transcript ? (
                            <Text style={{ color: LUCY_COLORS.textMuted, fontSize: 13, lineHeight: 18 }} numberOfLines={2}>
                              {item.raw_transcript.slice(0, 120)}
                            </Text>
                          ) : null}
                        </View>
                      )}

                      {/* Only show a snippet when expanded, and only from structured_text */}
                      {isExpanded ? (
                        <View style={styles.tlKeyPoints}>
                          {item.structured_text
                            ? extractKeyPoints(item.structured_text).map((pt, i) => (
                                <Text key={i} style={styles.tlKeyPoint}>{pt}</Text>
                              ))
                            : item.extracted_title
                              ? null
                              : <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 13, fontStyle: 'italic' }}>LUCY is processing this thought...</Text>
                          }
                        </View>
                      ) : null}

                      <View style={styles.tlCardFooter}>
                        <PrivacyBadge level={item.privacy_level} />
                        {/* Actions collapsed under a three-dot menu */}
                        <TouchableOpacity
                          style={styles.tlMenuBtn}
                          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                          onPress={() => setMenuTarget(item)}
                        >
                          <Text style={styles.tlMenuBtnText}>⋯</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
        <View style={{ height: 20 }} />
      </ScrollView>

      {/* Card action menu (⋯) */}
      <Modal transparent animationType="fade" visible={menuTarget !== null} onRequestClose={() => setMenuTarget(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setMenuTarget(null)}>
          <Pressable style={styles.actionSheet}>
            <Text style={styles.actionSheetTitle} numberOfLines={1}>
              {menuTarget?.extracted_title ?? menuTarget?.raw_transcript?.slice(0, 48) ?? 'Memory'}
            </Text>
            <TouchableOpacity
              style={styles.actionSheetItem}
              onPress={() => { const t = menuTarget; setMenuTarget(null); setFeedbackText(''); setFeedbackTarget(t); }}
            >
              <Text style={styles.actionSheetIcon}>?</Text>
              <Text style={styles.actionSheetLabel}>Correct this memory</Text>
            </TouchableOpacity>
            {menuTarget && menuTarget.processed !== 0 && menuTarget.processed !== 1 ? (
              <TouchableOpacity
                style={styles.actionSheetItem}
                onPress={() => { const t = menuTarget; setMenuTarget(null); if (t) void reprocessCapture(t); }}
              >
                <Text style={[styles.actionSheetIcon, { color: LUCY_COLORS.primary }]}>↻</Text>
                <Text style={styles.actionSheetLabel}>Reprocess</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={styles.actionSheetItem}
              onPress={() => { const t = menuTarget; setMenuTarget(null); if (t) confirmDeleteCapture(t); }}
            >
              <Text style={[styles.actionSheetIcon, { color: '#ef4444' }]}>✕</Text>
              <Text style={[styles.actionSheetLabel, { color: '#ef4444' }]}>Delete</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Feedback modal */}
      <Modal transparent animationType="fade" visible={feedbackTarget !== null} onRequestClose={() => setFeedbackTarget(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setFeedbackTarget(null)}>
          <Pressable style={styles.feedbackModal}>
            <Text style={styles.feedbackModalTitle}>Correct this memory</Text>
            <Text style={styles.feedbackModalSub} numberOfLines={2}>{feedbackTarget?.extracted_title ?? feedbackTarget?.raw_transcript?.slice(0, 80)}</Text>
            <TextInput
              style={styles.feedbackInput}
              placeholder="What's wrong? What should LUCY know instead?"
              placeholderTextColor={LUCY_COLORS.textSubtle}
              multiline autoFocus
              value={feedbackText}
              onChangeText={setFeedbackText}
            />
            <View style={styles.feedbackButtons}>
              <TouchableOpacity style={styles.feedbackCancel} onPress={() => setFeedbackTarget(null)}>
                <Text style={styles.feedbackCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.feedbackSend, !feedbackText.trim() && { opacity: 0.4 }]}
                disabled={!feedbackText.trim() || sending}
                onPress={() => void submitFeedback()}
              >
                <Text style={styles.feedbackSendText}>{sending ? '...' : 'Send to LUCY'}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Automation confirmation card */}
      {pendingAction ? (
        <Modal transparent animationType="slide" visible onRequestClose={() => setPendingAction(null)}>
          <Pressable style={styles.modalBackdrop} onPress={() => setPendingAction(null)}>
            <Pressable style={[styles.feedbackModal, { gap: 12 }]}>
              <Text style={{ fontSize: 10, fontWeight: '800', letterSpacing: 1.4, color: LUCY_COLORS.primary, textTransform: 'uppercase' }}>LUCY CAN DO THIS</Text>
              <Text style={{ fontSize: 18, fontWeight: '700', color: LUCY_COLORS.textDark }}>{pendingAction.displayText}</Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity
                  style={{ flex: 1, backgroundColor: LUCY_COLORS.primary, borderRadius: 12, paddingVertical: 13, alignItems: 'center', opacity: executingAction ? 0.5 : 1 }}
                  disabled={executingAction}
                  onPress={async () => {
                    setExecutingAction(true);
                    const { executeAction } = await import('../processing/automationEngine');
                    await executeAction(pendingAction);
                    setExecutingAction(false);
                    setPendingAction(null);
                    onQueued?.();
                  }}
                >
                  <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>{executingAction ? '...' : pendingAction.confirmText}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={{ paddingHorizontal: 16, justifyContent: 'center' }} onPress={() => setPendingAction(null)}>
                  <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 14 }}>Not now</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
    </>
  );
}

function LibraryView({
  tab,
  setTab,
  todos,
  ideas,
  expenses,
}: {
  tab: LibraryTab;
  setTab: (tab: LibraryTab) => void;
  todos: TodoRow[];
  ideas: IdeaRow[];
  expenses: ExpenseRow[];
}) {
  const tabs: LibraryTab[] = ['Todos', 'Ideas', 'Expenses', 'People'];
  return (
    <View style={styles.library}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabs}>
        {tabs.map((item) => (
          <TouchableOpacity key={item} style={[styles.tab, item === tab && styles.activeTab]} onPress={() => setTab(item)}>
            <Text style={[styles.tabText, item === tab && styles.activeText]}>{item}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <ScrollView style={styles.content}>
        {tab === 'Todos' && todos.map((item) => <Card key={item.id} title={item.task} detail={`${item.category} / ${item.urgency} / ${item.status}`} privacy={item.privacy_level} />)}
        {tab === 'Ideas' && ideas.map((item) => <Card key={item.id} title={item.title} detail={item.description} privacy={item.privacy_level} />)}
        {tab === 'Expenses' && expenses.map((item) => <Card key={item.id} title={`${item.amount ?? '-'} - ${item.description}`} detail={item.category} privacy={item.privacy_level} />)}
        {tab === 'People' && <PeopleTab />}
      </ScrollView>
    </View>
  );
}

function PeopleTab() {
  const [people, setPeople] = useState<Array<{ name: string; lastMentioned: string | null; mentionCount: number; typicalContext: string | null; pendingFollowUps: number }>>([]);
  const [selectedPerson, setSelectedPerson] = useState<string | null>(null);
  const [personCaptures, setPersonCaptures] = useState<CaptureRow[]>([]);
  const [loadingCaptures, setLoadingCaptures] = useState(false);

  useEffect(() => {
    void (async () => {
      const { getAllPersonContexts } = await import('../processing/relationshipEngine');
      const db = await getDatabase();
      setPeople(await getAllPersonContexts(db));
    })();
  }, []);

  const openPerson = async (name: string) => {
    setSelectedPerson(name);
    setLoadingCaptures(true);
    try {
      const db = await getDatabase();
      const rows = await db.getAllAsync<CaptureRow>(
        `SELECT * FROM captures WHERE raw_transcript LIKE ? OR extracted_title LIKE ? ORDER BY created_at DESC LIMIT 30`,
        [`%${name}%`, `%${name}%`],
      );
      setPersonCaptures(rows);
    } catch { setPersonCaptures([]); }
    setLoadingCaptures(false);
  };

  if (people.length === 0) return <EmptyLine text="People will appear here as you capture notes mentioning names." />;

  return (
    <>
      {people.map((p) => {
        const lastSeen = p.lastMentioned
          ? new Date(p.lastMentioned.includes('T') ? p.lastMentioned : `${p.lastMentioned.replace(' ', 'T')}Z`).toLocaleDateString()
          : 'Unknown';
        const detail = [
          `${p.mentionCount} mention${p.mentionCount !== 1 ? 's' : ''}`,
          `Last: ${lastSeen}`,
          p.pendingFollowUps > 0 ? `${p.pendingFollowUps} follow-up${p.pendingFollowUps !== 1 ? 's' : ''}` : null,
        ].filter(Boolean).join(' · ');
        return (
          <TouchableOpacity key={p.name} onPress={() => void openPerson(p.name)} activeOpacity={0.75}>
            <Card title={p.name} detail={`${detail} · tap to see mentions`} />
          </TouchableOpacity>
        );
      })}

      {/* Person detail modal */}
      <Modal transparent animationType="slide" visible={selectedPerson !== null} onRequestClose={() => setSelectedPerson(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setSelectedPerson(null)}>
          <Pressable style={[styles.feedbackModal, { maxHeight: '80%', gap: 12 }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontSize: 20, fontWeight: '800', color: LUCY_COLORS.textDark }}>{selectedPerson}</Text>
              <TouchableOpacity onPress={() => setSelectedPerson(null)}>
                <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 14, fontWeight: '700' }}>Done</Text>
              </TouchableOpacity>
            </View>
            <Text style={{ fontSize: 12, color: LUCY_COLORS.textSubtle }}>All captures mentioning {selectedPerson}</Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              {loadingCaptures ? (
                <Text style={{ color: LUCY_COLORS.textSubtle, padding: 16 }}>Loading...</Text>
              ) : personCaptures.length === 0 ? (
                <Text style={{ color: LUCY_COLORS.textSubtle, padding: 16 }}>No captures found.</Text>
              ) : personCaptures.map((c) => (
                <View key={c.id} style={{ backgroundColor: LUCY_COLORS.surface, borderRadius: 12, padding: 12, marginBottom: 8 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: LUCY_COLORS.textDark, marginBottom: 4 }} numberOfLines={2}>
                    {c.extracted_title ?? c.raw_transcript?.slice(0, 80)}
                  </Text>
                  <Text style={{ fontSize: 11, color: LUCY_COLORS.textSubtle }}>
                    {new Date(c.created_at.includes('T') ? c.created_at : `${c.created_at.replace(' ', 'T')}Z`).toLocaleString()}
                  </Text>
                </View>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function SectionTitle({ title }: { title: string }) {
  return <Text style={styles.sectionTitle}>{title}</Text>;
}

function EmptyLine({ text }: { text: string }) {
  return <Text style={styles.empty}>{text}</Text>;
}

function ReminderCard({ item }: { item: ReminderRow }) {
  const time = item.remind_at
    ? new Date(item.remind_at).toLocaleString(undefined, {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
      })
    : 'Time not specified';
  return <Card title={protectedPreview(item.text)} detail={item.notification_id ? time : `${time} · notification pending`} privacy={item.privacy_level} />;
}

function Card({ title, detail, privacy }: { title: string; detail: string; privacy?: 'private' | 'local' | 'normal' }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <Text style={styles.cardTitle}>{protectedPreview(title)}</Text>
        {privacy ? <PrivacyBadge level={privacy} /> : null}
      </View>
      <Text style={styles.detail}>{protectedPreview(detail)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  title: { fontSize: 30, letterSpacing: -0.8, fontWeight: '800', color: LUCY_COLORS.textDark },
  subtitle: { color: LUCY_COLORS.textMuted, fontSize: 14, marginTop: 4, marginBottom: 16 },
  viewNav: { flexDirection: 'row', padding: 4, borderRadius: 18, backgroundColor: LUCY_COLORS.surface, borderWidth: 1, borderColor: LUCY_COLORS.border, marginBottom: 17 },
  viewTab: { flex: 1, alignItems: 'center', paddingVertical: 13, borderRadius: 14 },  // larger tap target
  activeView: { backgroundColor: LUCY_COLORS.surfaceRaised },
  viewText: { color: LUCY_COLORS.textMuted, fontWeight: '700', fontSize: 13 },  // was 11 (too small)
  activeViewText: { color: LUCY_COLORS.primaryGlow },
  content: { flex: 1 },
  tonight: { backgroundColor: LUCY_COLORS.surfaceRaised, borderColor: LUCY_COLORS.primarySoft, borderWidth: 1, borderRadius: 24, padding: 19, marginBottom: 19 },
  todayDate: { color: LUCY_COLORS.textSubtle, fontSize: 12, fontWeight: '600', letterSpacing: 0.3, marginBottom: 2 },
  eyebrow: { color: LUCY_COLORS.primaryGlow, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  tonightTitle: { color: LUCY_COLORS.textDark, fontSize: 21, fontWeight: '700', marginTop: 9 },
  tonightDetail: { color: LUCY_COLORS.textMuted, fontSize: 14, marginTop: 7 },
  // Timeline
  tlDateHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 16 },
  tlDateLabel: { color: LUCY_COLORS.primary, fontSize: 11, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase', flexShrink: 0 },
  tlDateLine: { flex: 1, height: 1, backgroundColor: LUCY_COLORS.divider },
  tlRow: { flexDirection: 'row', gap: 0, marginBottom: 6, alignItems: 'flex-start' },
  tlLeft: { width: 68, alignItems: 'flex-end', paddingRight: 12, paddingTop: 12 },
  tlTime: { color: LUCY_COLORS.textSubtle, fontSize: 11, fontWeight: '600', marginBottom: 6 },
  tlSpineWrap: { alignItems: 'center', flex: 1 },
  tlDot: { width: 10, height: 10, borderRadius: 5, shadowOpacity: 0.5, shadowRadius: 4, elevation: 3 },
  tlLine: { width: 1.5, backgroundColor: LUCY_COLORS.divider, flex: 1, minHeight: 40 },
  tlCard: { flex: 1, backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 14, borderWidth: 1, borderColor: LUCY_COLORS.border, marginBottom: 0, flexDirection: 'row', overflow: 'hidden' },
  tlCardExpanded: { borderColor: 'rgba(255,140,66,0.2)' },
  tlAccent: { width: 3, borderRadius: 0 },
  tlCardContent: { flex: 1, padding: 12, gap: 4 },
  tlTitle: { color: LUCY_COLORS.textDark, fontSize: 14, fontWeight: '700', lineHeight: 20 },
  tlSnippet: { color: LUCY_COLORS.textMuted, fontSize: 12, lineHeight: 18 },
  tlKeyPoints: { marginTop: 8, gap: 3 },
  tlKeyPoint: { color: LUCY_COLORS.textDark, fontSize: 12, lineHeight: 18 },
  tlCardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  otdCard: { backgroundColor: LUCY_COLORS.surface, borderWidth: 1, borderColor: 'rgba(255,140,66,0.2)', borderRadius: 18, padding: 16, marginBottom: 14 },
  otdLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.5, color: LUCY_COLORS.primaryGlow, textTransform: 'uppercase', marginBottom: 6 },
  otdTitle: { fontSize: 15, fontWeight: '700', color: LUCY_COLORS.textDark, lineHeight: 22, marginBottom: 4 },
  otdSnippet: { fontSize: 13, color: LUCY_COLORS.textMuted, lineHeight: 19, fontStyle: 'italic' },
  otdMore: { fontSize: 11, color: LUCY_COLORS.textSubtle, marginTop: 6 },
  moodBar: { marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  moodLabel: { fontSize: 12, fontWeight: '700' },
  moodDots: { flexDirection: 'row', gap: 5 },
  moodDot: { width: 8, height: 8, borderRadius: 4 },
  contextPrompt: { backgroundColor: LUCY_COLORS.surfaceRaised, borderColor: LUCY_COLORS.primarySoft, borderWidth: 1, borderRadius: 20, padding: 16, marginBottom: 19 },
  contextPromptTitle: { color: LUCY_COLORS.textDark, fontSize: 17, fontWeight: '700', marginTop: 8 },
  contextIntro: { backgroundColor: LUCY_COLORS.surfaceRaised, borderColor: LUCY_COLORS.primarySoft, borderWidth: 1, borderRadius: 22, padding: 22, marginBottom: 14 },  // was 18
  contextCard: { backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 18, borderWidth: 1, borderColor: LUCY_COLORS.border, padding: 18, marginBottom: 12, gap: 9 },  // was 15
  contextLucyLabel: { color: LUCY_COLORS.primaryGlow, fontSize: 12, fontWeight: '700', letterSpacing: 0.3, textTransform: 'uppercase', marginBottom: 2 },
  contextSnippet: { color: LUCY_COLORS.textMuted, fontSize: 13, fontStyle: 'italic' },
  contextQuestion: { color: LUCY_COLORS.textDark, fontSize: 17, fontWeight: '800', lineHeight: 24 },
  contextInput: { minHeight: 64, color: LUCY_COLORS.textDark, borderRadius: 13, borderWidth: 1, borderColor: LUCY_COLORS.border, backgroundColor: LUCY_COLORS.surface, padding: 12, textAlignVertical: 'top' },
  contextButton: { backgroundColor: LUCY_COLORS.primary, paddingVertical: 11, borderRadius: 12, alignItems: 'center' },
  contextButtonDisabled: { opacity: 0.42 },
  contextButtonText: { color: LUCY_COLORS.white, fontWeight: '700' },
  knowledgeHero: { backgroundColor: LUCY_COLORS.surfaceRaised, borderColor: LUCY_COLORS.primarySoft, borderWidth: 1, borderRadius: 22, padding: 18, marginBottom: 15 },
  runTime: { color: LUCY_COLORS.textSubtle, fontSize: 12, marginTop: 10 },
  knowledgeCard: { backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 18, borderWidth: 1, borderColor: LUCY_COLORS.border, padding: 15, marginBottom: 10, gap: 7 },
  confidence: { color: LUCY_COLORS.primaryGlow, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  connection: { color: LUCY_COLORS.textDark, fontSize: 15, fontWeight: '700', lineHeight: 21 },
  relation: { color: LUCY_COLORS.primaryGlow },
  sectionTitle: { color: LUCY_COLORS.textDark, fontSize: 17, fontWeight: '700', marginBottom: 10, marginTop: 4 },
  empty: { color: LUCY_COLORS.textMuted, backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 16, padding: 16, marginBottom: 17 },
  pendingHint: { color: LUCY_COLORS.textMuted, fontSize: 13, marginBottom: 17, paddingHorizontal: 3 },
  library: { flex: 1 },
  tabs: { flexGrow: 0, marginBottom: 15 },
  tab: { paddingHorizontal: 15, paddingVertical: 10, borderRadius: 20, marginRight: 7, backgroundColor: LUCY_COLORS.surfaceRaised },
  activeTab: { backgroundColor: LUCY_COLORS.primary },
  tabText: { color: LUCY_COLORS.textMuted, fontWeight: '600' },
  activeText: { color: LUCY_COLORS.white },
  card: { backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 18, borderWidth: 1, borderColor: LUCY_COLORS.border, padding: 15, marginBottom: 10, gap: 7 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  cardTitle: { flex: 1, color: LUCY_COLORS.textDark, fontWeight: '700', fontSize: 16 },
  detail: { color: LUCY_COLORS.textMuted, fontSize: 14, lineHeight: 19 },
  loopCard: { backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 18, borderWidth: 1, borderColor: LUCY_COLORS.border, padding: 15, marginBottom: 10, gap: 10 },
  loopDescription: { color: LUCY_COLORS.textDark, fontSize: 15, lineHeight: 22, fontWeight: '500' },
  resolveButton: { alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: LUCY_COLORS.primarySoft },
  resolveText: { color: LUCY_COLORS.primaryGlow, fontSize: 13, fontWeight: '600' },
  musicCard: { backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 18, borderWidth: 1, borderColor: LUCY_COLORS.border, padding: 15, marginBottom: 10, gap: 10 },
  musicInfo: { gap: 3 },
  musicTitle: { color: LUCY_COLORS.textDark, fontSize: 16, fontWeight: '700' },
  musicArtist: { color: LUCY_COLORS.primaryGlow, fontSize: 13, fontWeight: '600' },
  musicTime: { color: LUCY_COLORS.textSubtle, fontSize: 12 },
  musicActions: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  streamButton: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10, backgroundColor: '#1DB954' },
  streamButtonApple: { backgroundColor: '#fc3c44' },
  streamButtonText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  dismissText: { color: LUCY_COLORS.textSubtle, fontSize: 13, paddingVertical: 7 },
  captureRow: { backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 18, borderWidth: 1, borderColor: LUCY_COLORS.border, padding: 15, marginBottom: 10 },
  captureTitle: { color: LUCY_COLORS.textDark, fontSize: 15, fontWeight: '800', lineHeight: 21, marginBottom: 4 },  // was 700 — clearer hierarchy
  captureText: { color: LUCY_COLORS.textMuted, fontSize: 13, lineHeight: 19 },
  captureTime: { color: LUCY_COLORS.textSubtle, fontSize: 12, marginTop: 7 },
  keyPoints: { marginTop: 8, gap: 3 },
  keyPoint: { color: LUCY_COLORS.textDark, fontSize: 13, lineHeight: 19 },
  structuredMemory: { backgroundColor: LUCY_COLORS.surface, borderRadius: 13, borderWidth: 1, borderColor: LUCY_COLORS.border, padding: 11, marginTop: 10 },
  structureToggle: { alignSelf: 'flex-start', marginTop: 10, paddingVertical: 4 },
  structureToggleText: { color: LUCY_COLORS.primaryGlow, fontSize: 12, fontWeight: '700' },
  structuredLabel: { color: LUCY_COLORS.primaryGlow, fontSize: 10, fontWeight: '700', letterSpacing: 0.8, marginBottom: 7 },
  structuredText: { color: LUCY_COLORS.textDark, fontSize: 13, lineHeight: 19 },
  captureMeta: { marginTop: 10, alignItems: 'center', justifyContent: 'flex-end', flexDirection: 'row', gap: 8 },
  captureStatus: { color: LUCY_COLORS.primaryGlow, fontWeight: '700', fontSize: 12, textTransform: 'capitalize' },
  tlQuickBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 14, borderWidth: 1, borderColor: LUCY_COLORS.primary + '44', paddingHorizontal: 14, paddingVertical: 10, marginBottom: 10, gap: 10 },
  tlQuickInput: { flex: 1, color: LUCY_COLORS.textDark, fontSize: 15, paddingVertical: 0 },
  tlQuickSend: { backgroundColor: LUCY_COLORS.primary, width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  tlQuickSendText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 12, borderWidth: 1, borderColor: LUCY_COLORS.border, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 8, gap: 8 },
  searchInput: { flex: 1, color: LUCY_COLORS.textDark, fontSize: 14 },
  searchClear: { color: LUCY_COLORS.textSubtle, fontSize: 14, fontWeight: '700' },
  searchResultsLabel: { color: LUCY_COLORS.textSubtle, fontSize: 11, marginBottom: 8, fontWeight: '600' },
  captureActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionBtn: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, backgroundColor: LUCY_COLORS.primarySoft, borderWidth: 1, borderColor: LUCY_COLORS.primarySoft },  // bigger tap target
  actionBtnText: { color: LUCY_COLORS.primary, fontSize: 12, fontWeight: '800' },
  actionOptionBtn: { backgroundColor: LUCY_COLORS.surfaceRaised, borderWidth: 1, borderColor: LUCY_COLORS.border, borderRadius: 12, padding: 14 },
  actionOptionText: { color: LUCY_COLORS.textDark, fontSize: 15, fontWeight: '600' },
  modalDone: { backgroundColor: LUCY_COLORS.primary, borderRadius: 12, paddingVertical: 13, alignItems: 'center' as const },
  modalDoneText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  modalSkip: { borderWidth: 1, borderColor: LUCY_COLORS.border, borderRadius: 12, paddingVertical: 13, alignItems: 'center' as const },
  modalSkipText: { color: LUCY_COLORS.textMuted, fontSize: 15, fontWeight: '600' },
  feedbackBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: LUCY_COLORS.border, alignItems: 'center', justifyContent: 'center' },  // was 22 (too small)
  feedbackBtnText: { color: LUCY_COLORS.textMuted, fontSize: 14, fontWeight: '700' },
  tlMenuBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  tlMenuBtnText: { color: LUCY_COLORS.textMuted, fontSize: 20, fontWeight: '800', lineHeight: 20, marginTop: -4 },
  actionSheet: { backgroundColor: LUCY_COLORS.surface, borderRadius: 20, paddingVertical: 8, width: '100%', borderWidth: 1, borderColor: LUCY_COLORS.border },
  actionSheetTitle: { color: LUCY_COLORS.textSubtle, fontSize: 12, fontWeight: '700', paddingHorizontal: 20, paddingTop: 10, paddingBottom: 8 },
  actionSheetItem: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 14 },
  actionSheetIcon: { width: 22, textAlign: 'center', color: LUCY_COLORS.textMuted, fontSize: 16, fontWeight: '700' },
  actionSheetLabel: { color: LUCY_COLORS.textDark, fontSize: 15, fontWeight: '600' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  feedbackModal: { backgroundColor: LUCY_COLORS.surface, borderRadius: 20, padding: 24, width: '100%', borderWidth: 1, borderColor: LUCY_COLORS.border, gap: 12 },
  feedbackModalTitle: { color: LUCY_COLORS.primaryGlow, fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  feedbackModalSub: { color: LUCY_COLORS.textMuted, fontSize: 14, lineHeight: 20 },
  feedbackInput: { backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 12, borderWidth: 1, borderColor: LUCY_COLORS.border, padding: 12, color: LUCY_COLORS.textDark, fontSize: 15, minHeight: 80, textAlignVertical: 'top' },
  feedbackButtons: { flexDirection: 'row', gap: 10 },
  feedbackCancel: { flex: 1, paddingVertical: 12, borderRadius: 11, borderWidth: 1, borderColor: LUCY_COLORS.border, alignItems: 'center' },
  feedbackCancelText: { color: LUCY_COLORS.textMuted, fontWeight: '600' },
  feedbackSend: { flex: 2, paddingVertical: 12, borderRadius: 11, backgroundColor: LUCY_COLORS.primary, alignItems: 'center' },
  feedbackSendText: { color: '#fff', fontWeight: '700' },
  activity: { borderLeftWidth: 2, borderLeftColor: LUCY_COLORS.primary, paddingLeft: 12, paddingTop: 9, marginTop: 10 },
  activityTitle: { color: LUCY_COLORS.textDark, fontSize: 14, fontWeight: '600' },
  activityTime: { color: LUCY_COLORS.textMuted, fontSize: 12, marginTop: 3 },
});
