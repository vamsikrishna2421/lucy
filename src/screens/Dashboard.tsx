import { useEffect, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { PrivacyBadge } from '../components/PrivacyBadge';
import { LUCY_COLORS } from '../config/colors';
import { getDatabase } from '../db';
import { captureStatus, listCaptureUpdates, listRecentCaptures, type CaptureRow } from '../db/captures';
import { answerContextRequest, listOpenContextRequests, type ContextRequestRow } from '../db/contextRequests';
import { listExpenses, type ExpenseRow } from '../db/expenses';
import { listIdeas, type IdeaRow } from '../db/ideas';
import { listInterests, type InterestRow } from '../db/interests';
import { getLatestOrganizationRun, listKnowledgeConnections, listKnowledgeEntities, listKnowledgeInsights, type KnowledgeConnectionRow, type KnowledgeEntityRow, type KnowledgeInsightRow, type OrganizationRunRow } from '../db/knowledge';
import { listOpenLoops, resolveOpenLoop, type OpenLoopRow } from '../db/openLoops';
import { listFollowUps, resolveFollowUp, type FollowUpRow } from '../db/followUps';
// Music detection removed
import { listPlaces, type PlaceRow } from '../db/places';
import { listReminders, type ReminderRow } from '../db/reminders';
import { listTodos, type TodoRow } from '../db/todos';
import { protectedPreview } from '../processing/privacy';
import { organizeMemory } from '../processing/organizer';
import { enqueueTranscript } from '../processing/extract';
import { archiveTodo } from '../db/todos';

type ViewMode = 'Now' | 'Context' | 'Memory' | 'Captured' | 'Library';
type LibraryTab = 'Todos' | 'Ideas' | 'Expenses' | 'Places' | 'Interests' | 'People';

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
  const [view, setView] = useState<ViewMode>('Now');
  const [tab, setTab] = useState<LibraryTab>('Todos');
  const [todos, setTodos] = useState<TodoRow[]>([]);
  const [ideas, setIdeas] = useState<IdeaRow[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [places, setPlaces] = useState<PlaceRow[]>([]);
  const [interests, setInterests] = useState<InterestRow[]>([]);
  const [reminders, setReminders] = useState<ReminderRow[]>([]);
  const [captures, setCaptures] = useState<CaptureRow[]>([]);
  const [updates, setUpdates] = useState<Record<number, CaptureRow[]>>({});
  const [contextRequests, setContextRequests] = useState<ContextRequestRow[]>([]);
  const [knowledgeEntities, setKnowledgeEntities] = useState<KnowledgeEntityRow[]>([]);
  const [knowledgeConnections, setKnowledgeConnections] = useState<KnowledgeConnectionRow[]>([]);
  const [knowledgeInsights, setKnowledgeInsights] = useState<KnowledgeInsightRow[]>([]);
  const [organizationRun, setOrganizationRun] = useState<OrganizationRunRow | null>(null);
  const [openLoops, setOpenLoops] = useState<OpenLoopRow[]>([]);
  const [followUps, setFollowUps] = useState<FollowUpRow[]>([]);
  const [moodTrend, setMoodTrend] = useState<{ dominant: string; positiveRatio: number; recentTones: string[] }>({ dominant: 'neutral', positiveRatio: 0.5, recentTones: [] });
  const [contextRefresh, setContextRefresh] = useState(0);

  useEffect(() => {
    void (async () => {
      const db = await getDatabase();
      const results = await Promise.all([
        listTodos(db),
        listIdeas(db),
        listExpenses(db),
        listPlaces(db),
        listInterests(db),
        listReminders(db),
        listRecentCaptures(db, 12),
        listOpenContextRequests(db),
        listKnowledgeEntities(db),
        listKnowledgeConnections(db),
        listKnowledgeInsights(db),
        getLatestOrganizationRun(db),
        listOpenLoops(db),
        listFollowUps(db),
      ]);
      setTodos(results[0]);
      setIdeas(results[1]);
      setExpenses(results[2]);
      setPlaces(results[3]);
      setInterests(results[4]);
      setReminders(results[5]);
      setCaptures(results[6]);
      setContextRequests(results[7]);
      setKnowledgeEntities(results[8]);
      setKnowledgeConnections(results[9]);
      setKnowledgeInsights(results[10]);
      setOrganizationRun(results[11]);
      setOpenLoops(results[12]);
      setFollowUps(results[13]);
      try {
        const { getMoodTrend } = await import('../processing/temporalEngine');
        setMoodTrend(await getMoodTrend(db, 7));
      } catch { /* non-critical */ }
      const nextUpdates = await listCaptureUpdates(db, results[6].map((capture) => capture.id));
      setUpdates(groupUpdates(nextUpdates));
    })();
  }, [refreshToken, contextRefresh]);

  const pendingTodos = todos.filter((item) => item.status === 'pending');
  const focusTasks = pendingTodos.filter((item) => item.urgency === 'high').slice(0, 3);
  const displayTasks = focusTasks.length ? focusTasks : pendingTodos.slice(0, 3);
  const views: ViewMode[] = ['Now', 'Context', 'Memory', 'Captured', 'Library'];

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Today</Text>
      <Text style={styles.subtitle}>What matters now, pulled from your memory.</Text>
      <View style={styles.viewNav}>
        {views.map((item) => (
          <TouchableOpacity key={item} style={[styles.viewTab, view === item && styles.activeView]} onPress={() => setView(item)}>
            <Text style={[styles.viewText, view === item && styles.activeViewText]}>{item}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {view === 'Now' ? <NowView todos={displayTasks} reminders={reminders} captures={captures} contextCount={contextRequests.length} openLoops={openLoops} followUps={followUps} moodTrend={moodTrend} onOpenContext={() => setView('Context')} onLoopResolved={() => setContextRefresh((v) => v + 1)} /> : null}
      {view === 'Context' ? (
        <NeedsContextView requests={contextRequests} onAnswered={() => setContextRefresh((value) => value + 1)} />
      ) : null}
      {view === 'Memory' ? (
        <KnowledgeView run={organizationRun} entities={knowledgeEntities} connections={knowledgeConnections} insights={knowledgeInsights} />
      ) : null}
      {view === 'Captured' ? <CapturedView captures={captures} updates={updates} onFeedback={() => setContextRefresh((v) => v + 1)} /> : null}
      {view === 'Library' ? (
        <LibraryView
          tab={tab}
          setTab={setTab}
          todos={todos}
          ideas={ideas}
          expenses={expenses}
          places={places}
          interests={interests}
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
      {contextCount ? (
        <TouchableOpacity style={styles.contextPrompt} onPress={onOpenContext}>
          <Text style={styles.eyebrow}>NEEDS CONTEXT</Text>
          <Text style={styles.contextPromptTitle}>
            {contextCount} memory detail{contextCount === 1 ? '' : 's'} could become clearer
          </Text>
          <Text style={styles.tonightDetail}>Add a little context when you have time. LUCY keeps your original thought unchanged.</Text>
        </TouchableOpacity>
      ) : null}
      {openLoops.length > 0 ? (
        <>
          <SectionTitle title="Loose ends" />
          {openLoops.map((item) => (
            <View style={styles.loopCard} key={item.id}>
              <Text style={styles.loopDescription}>{protectedPreview(item.description)}</Text>
              <TouchableOpacity style={styles.resolveButton} onPress={() => void handleResolveLoop(item.id)}>
                <Text style={styles.resolveText}>Done with this</Text>
              </TouchableOpacity>
            </View>
          ))}
        </>
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

function KnowledgeView({
  run,
  entities,
  connections,
  insights,
}: {
  run: OrganizationRunRow | null;
  entities: KnowledgeEntityRow[];
  connections: KnowledgeConnectionRow[];
  insights: KnowledgeInsightRow[];
}) {
  return (
    <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.knowledgeHero}>
        <Text style={styles.eyebrow}>UNDERSTAND + CONNECT</Text>
        <Text style={styles.tonightTitle}>Memory Map</Text>
        <Text style={styles.tonightDetail}>
          {run?.summary ?? 'LUCY will form a map as structured memories accumulate.'}
        </Text>
        {run ? <Text style={styles.runTime}>Last organized {displayTimestamp(run.created_at)} / {run.trigger}</Text> : null}
      </View>
      <SectionTitle title="Learned Signals" />
      {insights.map((insight) => (
        <View style={styles.knowledgeCard} key={insight.id}>
          <View style={styles.cardTop}>
            <Text style={styles.cardTitle}>{protectedPreview(insight.title)}</Text>
            <Text style={styles.confidence}>{insight.confidence}</Text>
          </View>
          <Text style={styles.detail}>{protectedPreview(insight.detail)}</Text>
        </View>
      ))}
      {!insights.length ? <EmptyLine text="Clarifications and repeated questions will appear here as local learning signals." /> : null}
      <SectionTitle title="Connections" />
      {connections.map((connection) => (
        <View style={styles.knowledgeCard} key={connection.id}>
          <Text style={styles.connection}>
            {connection.source_name} <Text style={styles.relation}>{connection.relation}</Text> {connection.target_name}
          </Text>
          <Text style={styles.detail}>{connection.explanation} / {connection.confidence}</Text>
        </View>
      ))}
      {!connections.length ? <EmptyLine text="Connections appear when a memory contains related projects, people, areas, or interests." /> : null}
      <SectionTitle title="Known Topics" />
      {entities.slice(0, 12).map((entity) => (
        <Card key={entity.id} title={entity.name} detail={`${entity.entity_type} / ${entity.confidence} / ${entity.evidence_count} observation${entity.evidence_count === 1 ? '' : 's'}`} privacy={entity.privacy_level} />
      ))}
      {!entities.length ? <EmptyLine text="No stable topics extracted yet." /> : null}
    </ScrollView>
  );
}

function CapturedView({ captures, updates, onFeedback }: { captures: CaptureRow[]; updates: Record<number, CaptureRow[]>; onFeedback: () => void }) {
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [feedbackTarget, setFeedbackTarget] = useState<CaptureRow | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<CaptureRow[] | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  const [feedbackText, setFeedbackText] = useState('');
  const [sending, setSending] = useState(false);
  const [actionTarget, setActionTarget] = useState<CaptureRow | null>(null);
  const [actionResult, setActionResult] = useState<string | null>(null);
  const [actionRunning, setActionRunning] = useState(false);

  const submitFeedback = async () => {
    if (!feedbackTarget || !feedbackText.trim()) return;
    setSending(true);
    try {
      const correction = `[Correction for previous capture: ${feedbackTarget.extracted_title ?? feedbackTarget.raw_transcript?.slice(0, 60)}]\n${feedbackText.trim()}`;
      await enqueueTranscript(correction, 'text', feedbackTarget.privacy_level === 'private');
      setFeedbackTarget(null);
      setFeedbackText('');
      onFeedback();
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <View style={styles.searchBar}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search memories..."
          placeholderTextColor={LUCY_COLORS.textSubtle}
          value={searchQuery}
          onChangeText={handleSearch}
          returnKeyType="search"
        />
        {searchQuery ? (
          <TouchableOpacity onPress={() => { setSearchQuery(''); setSearchResults(null); }}>
            <Text style={styles.searchClear}>✕</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {searchResults !== null && (
        <Text style={styles.searchResultsLabel}>
          {searchResults.length > 0 ? `${searchResults.length} result${searchResults.length !== 1 ? 's' : ''}` : 'No matching memories'}
        </Text>
      )}
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {displayCaptures.map((item) => (
          <View key={item.id} style={styles.captureRow}>
            {item.extracted_title ? (
              <Text style={styles.captureTitle}>{protectedPreview(item.extracted_title)}</Text>
            ) : null}
            <Text style={styles.captureText} numberOfLines={1} ellipsizeMode="tail">{protectedPreview(item.raw_transcript)}</Text>
            {item.structured_text ? (
              <View style={styles.keyPoints}>
                {extractKeyPoints(item.structured_text).map((point, i) => (
                  <Text key={i} style={styles.keyPoint}>{point}</Text>
                ))}
              </View>
            ) : null}
            <Text style={styles.captureTime}>Captured {displayTimestamp(item.created_at)}</Text>
            {item.structured_text ? (
              <TouchableOpacity
                style={styles.structureToggle}
                onPress={() => setExpanded((current) => ({ ...current, [item.id]: !current[item.id] }))}
              >
                <Text style={styles.structureToggleText}>{expanded[item.id] ? 'Hide structure' : 'View structure'}</Text>
              </TouchableOpacity>
            ) : null}
            {item.structured_text && expanded[item.id] ? (
              <View style={styles.structuredMemory}>
                <Text style={styles.structuredLabel}>STRUCTURED MEMORY</Text>
                <Text style={styles.structuredText}>{protectedPreview(item.structured_text)}</Text>
              </View>
            ) : null}
            <View style={styles.captureMeta}>
              <Text style={styles.captureStatus}>{captureStatus(item) === 'complete' ? 'Remembered' : captureStatus(item)}</Text>
              {captureStatus(item) === 'complete' ? <PrivacyBadge level={item.privacy_level} /> : null}
              <View style={styles.captureActions}>
                <TouchableOpacity style={styles.actionBtn} onPress={() => { setActionTarget(item); }}>
                  <Text style={styles.actionBtnText}>✦ AI</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.feedbackBtn} onPress={() => { setFeedbackText(''); setFeedbackTarget(item); }}>
                  <Text style={styles.feedbackBtnText}>?</Text>
                </TouchableOpacity>
              </View>
            </View>
            {(updates[item.id] ?? []).map((update) => (
              <View key={update.id} style={styles.activity}>
                <Text style={styles.activityTitle}>{protectedPreview(update.raw_transcript)}</Text>
                <Text style={styles.activityTime}>Completed {displayTimestamp(update.created_at)}</Text>
              </View>
            ))}
          </View>
        ))}
        {displayCaptures.length === 0 && !searchQuery ? <EmptyLine text="New captures will show here." /> : null}
      </ScrollView>

      {/* Text Actions Modal */}
      <Modal transparent animationType="slide" visible={actionTarget !== null} onRequestClose={() => { setActionTarget(null); setActionResult(null); }}>
        <Pressable style={styles.modalBackdrop} onPress={() => { setActionTarget(null); setActionResult(null); }}>
          <Pressable style={[styles.feedbackModal, { maxHeight: '80%' }]}>
            <Text style={styles.feedbackModalTitle}>AI Actions</Text>
            <Text style={styles.feedbackModalSub} numberOfLines={2}>{actionTarget?.extracted_title ?? actionTarget?.raw_transcript?.slice(0, 80)}</Text>
            {!actionResult ? (
              <View style={{ gap: 8, marginTop: 4 }}>
                {(['summarize','improve','action_items','translate','explain','structure'] as const).map((action) => (
                  <TouchableOpacity
                    key={action}
                    style={[styles.actionOptionBtn, actionRunning && { opacity: 0.5 }]}
                    disabled={actionRunning}
                    onPress={async () => {
                      if (!actionTarget?.raw_transcript) return;
                      setActionRunning(true);
                      try {
                        const { runTextAction, TEXT_ACTION_LABELS } = await import('../processing/textActions');
                        const res = await runTextAction(action, actionTarget.raw_transcript);
                        setActionResult(`${TEXT_ACTION_LABELS[action]}:\n\n${res.result}`);
                      } finally {
                        setActionRunning(false);
                      }
                    }}
                  >
                    <Text style={styles.actionOptionText}>
                      {action === 'summarize' ? 'Summarize' : action === 'improve' ? 'Improve writing' : action === 'action_items' ? 'Extract action items' : action === 'translate' ? 'Translate to English' : action === 'explain' ? 'Explain this' : 'Structure notes'}
                    </Text>
                  </TouchableOpacity>
                ))}
                {actionRunning ? <Text style={{ color: LUCY_COLORS.textMuted, fontSize: 13, textAlign: 'center' }}>LUCY is working...</Text> : null}
              </View>
            ) : (
              <View style={{ gap: 12 }}>
                <ScrollView style={{ maxHeight: 260 }} showsVerticalScrollIndicator={false}>
                  <Text style={{ color: LUCY_COLORS.textDark, fontSize: 14, lineHeight: 22 }}>{actionResult}</Text>
                </ScrollView>
                <TouchableOpacity style={styles.modalDone} onPress={() => setActionResult(null)}>
                  <Text style={styles.modalDoneText}>Try another action</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalSkip} onPress={() => { setActionTarget(null); setActionResult(null); }}>
                  <Text style={styles.modalSkipText}>Done</Text>
                </TouchableOpacity>
              </View>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal transparent animationType="fade" visible={feedbackTarget !== null} onRequestClose={() => setFeedbackTarget(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setFeedbackTarget(null)}>
          <Pressable style={styles.feedbackModal}>
            <Text style={styles.feedbackModalTitle}>Correct this memory</Text>
            <Text style={styles.feedbackModalSub} numberOfLines={2}>{feedbackTarget?.extracted_title ?? feedbackTarget?.raw_transcript?.slice(0, 80)}</Text>
            <TextInput
              style={styles.feedbackInput}
              placeholder="What's wrong? What should LUCY know instead?"
              placeholderTextColor={LUCY_COLORS.textSubtle}
              multiline
              autoFocus
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
    </>
  );
}

function LibraryView({
  tab,
  setTab,
  todos,
  ideas,
  expenses,
  places,
  interests,
}: {
  tab: LibraryTab;
  setTab: (tab: LibraryTab) => void;
  todos: TodoRow[];
  ideas: IdeaRow[];
  expenses: ExpenseRow[];
  places: PlaceRow[];
  interests: InterestRow[];
}) {
  const tabs: LibraryTab[] = ['Todos', 'Ideas', 'Expenses', 'Places', 'Interests', 'People'];
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
        {tab === 'Places' && places.map((item) => <Card key={item.id} title={item.name} detail={item.reason} privacy={item.privacy_level} />)}
        {tab === 'Interests' && interests.map((item) => <Card key={item.id} title={item.topic} detail={`${item.strength} / mentioned ${item.mention_count} time(s)`} />)}
        {tab === 'People' && <PeopleTab />}
      </ScrollView>
    </View>
  );
}

function PeopleTab() {
  const [people, setPeople] = useState<Array<{ name: string; lastMentioned: string | null; mentionCount: number; typicalContext: string | null; pendingFollowUps: number }>>([]);

  useEffect(() => {
    void (async () => {
      const { getAllPersonContexts } = await import('../processing/relationshipEngine');
      const db = await getDatabase();
      setPeople(await getAllPersonContexts(db));
    })();
  }, []);

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
          <Card key={p.name} title={p.name} detail={detail} />
        );
      })}
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
  title: { fontSize: 30, letterSpacing: -0.8, fontWeight: '700', color: LUCY_COLORS.textDark },
  subtitle: { color: LUCY_COLORS.textMuted, fontSize: 14, marginTop: 4, marginBottom: 16 },
  viewNav: { flexDirection: 'row', padding: 4, borderRadius: 18, backgroundColor: LUCY_COLORS.surface, borderWidth: 1, borderColor: LUCY_COLORS.border, marginBottom: 17 },
  viewTab: { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 14 },
  activeView: { backgroundColor: LUCY_COLORS.surfaceRaised },
  viewText: { color: LUCY_COLORS.textMuted, fontWeight: '700' },
  activeViewText: { color: LUCY_COLORS.primaryGlow },
  content: { flex: 1 },
  tonight: { backgroundColor: LUCY_COLORS.surfaceRaised, borderColor: LUCY_COLORS.primarySoft, borderWidth: 1, borderRadius: 24, padding: 19, marginBottom: 19 },
  eyebrow: { color: LUCY_COLORS.primaryGlow, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  tonightTitle: { color: LUCY_COLORS.textDark, fontSize: 21, fontWeight: '700', marginTop: 9 },
  tonightDetail: { color: LUCY_COLORS.textMuted, fontSize: 14, marginTop: 7 },
  moodBar: { marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  moodLabel: { fontSize: 12, fontWeight: '700' },
  moodDots: { flexDirection: 'row', gap: 5 },
  moodDot: { width: 8, height: 8, borderRadius: 4 },
  contextPrompt: { backgroundColor: LUCY_COLORS.surfaceRaised, borderColor: LUCY_COLORS.primarySoft, borderWidth: 1, borderRadius: 20, padding: 16, marginBottom: 19 },
  contextPromptTitle: { color: LUCY_COLORS.textDark, fontSize: 17, fontWeight: '700', marginTop: 8 },
  contextIntro: { backgroundColor: LUCY_COLORS.surfaceRaised, borderColor: LUCY_COLORS.primarySoft, borderWidth: 1, borderRadius: 22, padding: 18, marginBottom: 14 },
  contextCard: { backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 18, borderWidth: 1, borderColor: LUCY_COLORS.border, padding: 15, marginBottom: 12, gap: 9 },
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
  captureTitle: { color: LUCY_COLORS.textDark, fontSize: 15, fontWeight: '700', lineHeight: 20, marginBottom: 4 },
  captureText: { color: LUCY_COLORS.textMuted, fontSize: 13, lineHeight: 18 },
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
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 12, borderWidth: 1, borderColor: LUCY_COLORS.border, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 8, gap: 8 },
  searchInput: { flex: 1, color: LUCY_COLORS.textDark, fontSize: 14 },
  searchClear: { color: LUCY_COLORS.textSubtle, fontSize: 14, fontWeight: '700' },
  searchResultsLabel: { color: LUCY_COLORS.textSubtle, fontSize: 11, marginBottom: 8, fontWeight: '600' },
  captureActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionBtn: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: LUCY_COLORS.primarySoft, borderWidth: 1, borderColor: LUCY_COLORS.primarySoft },
  actionBtnText: { color: LUCY_COLORS.primary, fontSize: 11, fontWeight: '800' },
  actionOptionBtn: { backgroundColor: LUCY_COLORS.surfaceRaised, borderWidth: 1, borderColor: LUCY_COLORS.border, borderRadius: 12, padding: 14 },
  actionOptionText: { color: LUCY_COLORS.textDark, fontSize: 15, fontWeight: '600' },
  modalDone: { backgroundColor: LUCY_COLORS.primary, borderRadius: 12, paddingVertical: 13, alignItems: 'center' as const },
  modalDoneText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  modalSkip: { borderWidth: 1, borderColor: LUCY_COLORS.border, borderRadius: 12, paddingVertical: 13, alignItems: 'center' as const },
  modalSkipText: { color: LUCY_COLORS.textMuted, fontSize: 15, fontWeight: '600' },
  feedbackBtn: { width: 22, height: 22, borderRadius: 11, borderWidth: 1, borderColor: LUCY_COLORS.border, alignItems: 'center', justifyContent: 'center' },
  feedbackBtnText: { color: LUCY_COLORS.textMuted, fontSize: 12, fontWeight: '700' },
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
