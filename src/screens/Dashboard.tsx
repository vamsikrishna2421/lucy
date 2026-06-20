import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Easing, Image, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { PrivacyBadge } from '../components/PrivacyBadge';
import { ReviewCardDeck, type ReviewCard } from '../components/ReviewCardDeck';
import { MeetingShareBar } from '../components/MeetingShareBar';
import { formatMeetingRowText } from '../processing/meetingFormat';
import { LUCY_COLORS } from '../config/colors';
import { FadeInUp } from '../components/Motion';
import { getDatabase } from '../db';
import { captureStatus, listCaptureUpdates, listRecentCaptures, listListenSessions, type CaptureRow, type ListenSessionGroup } from '../db/captures';
import { answerContextRequest, listOpenContextRequests, type ContextRequestRow } from '../db/contextRequests';
import { listExpenses, type ExpenseRow } from '../db/expenses';
import { listIdeas, type IdeaRow } from '../db/ideas';
import { listOpenLoops, resolveOpenLoop, type OpenLoopRow } from '../db/openLoops';
import { listFollowUps, resolveFollowUp, type FollowUpRow } from '../db/followUps';
// Music detection removed
import { listReminders, type ReminderRow } from '../db/reminders';
import { listTodos, type TodoRow } from '../db/todos';
import { protectedPreview } from '../processing/privacy';
import { ShieldedText, type ProtectedValueLite } from '../components/ShieldedText';
import { organizeMemory } from '../processing/organizer';
import { enqueueTranscript } from '../processing/extract';
import { archiveTodo } from '../db/todos';
import { GalaxyView } from './Galaxy';
import { DocumentsTab } from '../components/DocumentsTab';
import { ScheduleTab } from '../components/ScheduleTab';
import { ProjectsTab } from '../components/ProjectsTab';
import { MoneyGoals } from '../components/MoneyGoals';
import { WorkspaceHome } from '../components/WorkspaceHome';
import { AskScreen } from './Ask';
import { Ionicons } from '@expo/vector-icons';
import { SegmentedControl, type SegmentOption } from '../components/SegmentedControl';
import { ActionSheet, Toast, type SheetAction } from '../components/ActionSheet';
import { LucyEmptyState } from '../components/LucyEmptyState';
import { CommitmentsSection } from '../components/CommitmentsSection';

const VIEW_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  'Timeline': 'time-outline',
  'Focus Now': 'flash-outline',
  'Ask Lucy': 'chatbubble-ellipses-outline',
  'Health': 'heart-outline',
};
import Svg, {
  Circle as SvgCircle,
  Path as SvgPath,
  Line as SvgLine,
  Defs as SvgDefs,
  LinearGradient as SvgLinearGradient,
  Stop as SvgStop,
  G as SvgG,
  Rect as SvgRect,
} from 'react-native-svg';
import type { MoodGraph as MoodGraphT, MoodPoint as MoodPointT, DayHighlight as DayHighlightT } from '../processing/moodGraph';
import { DR_LUCY_DISCLAIMER as DR_LUCY_DISCLAIMER_TEXT } from '../processing/drLucy';
import { StoryView, type StorySubject } from './StoryView';
import { StalenessReviewCard, ContextBatchCard } from '../components/StalenessReviewCard';
import {
  ensureStalenessTable,
  listPendingReviews,
  getContextBatch,
  runStalenessCheck,
  type StalenessReview,
  type ContextBatch,
} from '../processing/stalenessEngine';

type ViewMode = 'Focus Now' | 'Timeline' | 'Ask Lucy' | 'Health' | 'Brain';
type LibraryTab = 'Home' | 'Galaxy' | 'Documents' | 'Calendar' | 'Resources' | 'Projects' | 'Todos' | 'Ideas' | 'Expenses' | 'Goals' | 'People' | 'Meetings' | 'Listen' | 'Reminders' | 'Gallery' | 'Medications';

// Display names (internal keys kept stable).
const TAB_LABEL: Record<LibraryTab, string> = {
  Home: 'Workspace', Calendar: 'Calendar', Documents: 'Documents', Resources: 'Online resources', Galaxy: 'Glossary',
  Meetings: 'Meetings', Listen: 'Listen data', Projects: 'Projects', Ideas: 'Ideas', Expenses: 'Expenses', Goals: 'Money goals',
  People: 'People', Todos: 'Todos', Reminders: 'Reminders', Gallery: 'Scans & photos', Medications: 'Medications',
};

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

/**
 * Decide what summary text to show in the collapsed card body.
 *
 * Priority order:
 *   1. extraction.summary  — 1-2 sentence AI abstract written at extraction time.
 *      This is the best signal: it is intentionally compact and human-readable.
 *   2. structured_text first non-metadata line — the lead value from the structured
 *      memory block (e.g. "Discussed partnership model with Priya…").
 *   3. raw_transcript trimmed to 200 chars — raw fallback for unprocessed cards.
 *
 * We deliberately do NOT generate a fresh LLM abstract per-card render — that
 * would fan out API calls every scroll. The extraction.summary field (already
 * produced during the single extraction pass) is the right place for this text.
 */
function getCardSummaryText(
  item: CaptureRow,
  extraction: import('../types/extraction').ExtractionResult | null,
): string | null {
  // 1. AI summary from extraction result (best quality)
  if (extraction?.summary && extraction.summary.trim().length > 10) {
    return extraction.summary.trim();
  }
  // 2. Lead value from structured_text (skip label-only lines)
  if (item.structured_text) {
    const lines = item.structured_text.split('\n');
    for (const line of lines) {
      const colon = line.indexOf(':');
      if (colon === -1) continue;
      const label = line.slice(0, colon).trim().toLowerCase();
      if (['title', 'type'].includes(label)) continue;
      const value = line.slice(colon + 1).trim();
      if (value.length > 15) return value;
    }
  }
  // 3. Raw transcript fallback
  if (item.raw_transcript && item.raw_transcript.trim().length > 0) {
    return item.raw_transcript.trim().slice(0, 200);
  }
  return null;
}

/**
 * Returns a compact source icon glyph + label for the header badge row.
 * Using plain unicode chars keeps the bundle clean and renders reliably on
 * both iOS and Android without requiring an icon font.
 */
function sourceLabel(source: import('../types/extraction').CaptureSource): { glyph: string; label: string; color: string } {
  switch (source) {
    case 'passive': return { glyph: '◎', label: 'LISTEN', color: '#5B8CFF' };
    case 'meeting': return { glyph: '◈', label: 'MEETING', color: '#60A5FA' };
    case 'voice':   return { glyph: '◉', label: 'VOICE', color: LUCY_COLORS.primaryGlow };
    case 'text':    return { glyph: '◈', label: 'TEXT', color: LUCY_COLORS.textMuted };
    default:        return { glyph: '◈', label: 'CAPTURE', color: LUCY_COLORS.textMuted };
  }
}

/**
 * Returns an accent color and short label for the note_type extracted by AI.
 * Falls back gracefully when extraction is not yet available.
 */
function noteTypeLabel(noteType: import('../types/extraction').NoteType | undefined): { label: string; color: string } | null {
  if (!noteType) return null;
  const map: Partial<Record<import('../types/extraction').NoteType, { label: string; color: string }>> = {
    task:           { label: 'TASK', color: '#FF8C42' },
    idea:           { label: 'IDEA', color: '#818CF8' },
    meeting:        { label: 'MEETING', color: '#60A5FA' },
    journal:        { label: 'JOURNAL', color: LUCY_COLORS.textMuted },
    reminder:       { label: 'REMINDER', color: '#A78BFA' },
    decision:       { label: 'DECISION', color: '#FB923C' },
    project_update: { label: 'PROJECT', color: LUCY_COLORS.primaryGlow },
    resource:       { label: 'RESOURCE', color: '#2DD4BF' },
    thought:        { label: 'THOUGHT', color: LUCY_COLORS.textSubtle },
  };
  return map[noteType] ?? null;
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

function greetingForHour(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function DashboardScreen({ refreshToken, onAskAbout, requestedView, requestKey, onViewChange, initialAskQuestion }: {
  refreshToken: number;
  onAskAbout?: (question: string) => void;
  requestedView?: ViewMode;
  requestKey?: number;
  onViewChange?: (v: ViewMode) => void;
  initialAskQuestion?: string;
}) {
  const [view, setView] = useState<ViewMode>('Timeline');
  const [tab, setTab] = useState<LibraryTab>('Home');
  const [userName, setUserName] = useState('');

  // Allow the parent (bottom nav) to push a view in (e.g. Brain, Ask Lucy). Tapping Workspace always
  // lands on its Home grid, not whatever sub-section (Calendar/Documents) was last open.
  useEffect(() => {
    if (requestedView) setView(requestedView);
    if (requestedView === 'Brain') setTab('Home');
  }, [requestKey]);

  // Report the current view up so the bottom nav can highlight Home vs Brain.
  useEffect(() => { onViewChange?.(view); }, [view]);
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
  const [stalenessReviews, setStalenessReviews] = useState<StalenessReview[]>([]);
  const [contextBatch, setContextBatch] = useState<ContextBatch | null>(null);

  useEffect(() => {
    void (async () => {
      const db = await getDatabase();
      const results = await Promise.all([
        listTodos(db),
        listIdeas(db),
        listExpenses(db),
        listReminders(db),
        listRecentCaptures(db, 30),
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
      // Load staleness reviews and context batch
      try {
        await ensureStalenessTable(db);
        // Run a lightweight staleness check on every dashboard load (rate-limited inside)
        await runStalenessCheck(db);
        const reviews = await listPendingReviews(db);
        setStalenessReviews(reviews.filter((r) => r.kind !== 'context_overflow'));
        const batch = await getContextBatch(db);
        setContextBatch(batch.total > 3 ? batch : null);
      } catch { /* non-critical */ }
      try {
        const { getUserProfile } = await import('../db/userProfile');
        const profile = await getUserProfile(db);
        setUserName((profile.name ?? '').trim().split(/\s+/)[0] ?? '');
      } catch { /* non-critical */ }
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
  // Brain is reached via the bottom nav, so it's not in the top tab row.
  const views: ViewMode[] = ['Timeline', 'Focus Now', 'Ask Lucy', 'Health'];
  const viewOptions: SegmentOption<ViewMode>[] = views.map((v) => ({ value: v, label: v, icon: VIEW_ICON[v] }));

  // Lucy "speaks" — a warm, reactive two-part greeting that mirrors the day's state. The orb itself
  // is the single global overlay (App.tsx) that sits in this hero's top-right, so the copy reads as
  // her companion voice without seating a second orb here.
  const heroLine = pendingTodos.length
    ? `I'm holding ${pendingTodos.length} open task${pendingTodos.length === 1 ? '' : 's'} for you — tap Focus Now when you're ready.`
    : captures.length
      ? "You're all caught up. I'll keep watch and tidy things quietly."
      : 'Hold the mic or snap anything — I\'ll organize what matters.';

  return (
    <View style={styles.container}>
      <View style={styles.homeHero}>
        <View style={styles.homeHeroGlow} />
        <Text style={styles.todayDate}>{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</Text>
        <Text style={styles.title} numberOfLines={1}>{greetingForHour(new Date().getHours())}{userName ? `, ${userName}` : ''}</Text>
        <Text style={styles.subtitle} numberOfLines={2}>{heroLine}</Text>
      </View>
      <SegmentedControl options={viewOptions} value={view} onChange={setView} style={styles.viewNav} />
      {view === 'Focus Now' ? <NowView todos={displayTasks} reminders={reminders} captures={captures} contextCount={contextRequests.length} openLoops={openLoops} followUps={followUps} moodTrend={moodTrend} onThisDay={onThisDay} onOpenContext={() => {}} onLoopResolved={() => setContextRefresh((v) => v + 1)} stalenessReviews={stalenessReviews} contextBatch={contextBatch} onStalenessResolved={() => setContextRefresh((v) => v + 1)} /> : null}
      {view === 'Timeline' ? <TimelineView captures={captures} moodsByCapture={moodsByCapture} onFeedback={() => setContextRefresh((v) => v + 1)} onQueued={() => setContextRefresh((v) => v + 1)} onAskAbout={onAskAbout} /> : null}
      {view === 'Ask Lucy' ? <AskScreen initialQuestion={initialAskQuestion} /> : null}
      {view === 'Brain' ? <LibraryView tab={tab} setTab={setTab} todos={todos} ideas={ideas} expenses={expenses} /> : null}
      {view === 'Health' ? <HealthView /> : null}
    </View>
  );
}

// ─── Extraction chips ─────────────────────────────────────────────────────────

type ChipItem = { type: string; accent: string; label: string; sub: string };

function buildChips(extraction: import('../types/extraction').ExtractionResult): ChipItem[] {
  const chips: ChipItem[] = [];
  for (const t of extraction.tasks ?? []) {
    chips.push({
      type: t.urgency === 'high' ? 'TASK · HIGH URGENCY' : 'TASK',
      accent: t.urgency === 'high' ? '#FF8C42' : LUCY_COLORS.primary,
      label: t.task,
      sub: t.context ? t.context.slice(0, 50) : t.category,
    });
  }
  for (const e of extraction.expenses ?? []) {
    chips.push({
      type: 'EXPENSE',
      accent: '#4ADE80',
      label: `${e.amount ? '$' + e.amount + ' · ' : ''}${e.description}`,
      sub: `Categorised: ${e.category}`,
    });
  }
  for (const f of extraction.follow_ups ?? []) {
    chips.push({
      type: 'FOLLOW-UP',
      accent: '#FB923C',
      label: `${f.assignee} — ${f.action}`,
      sub: 'Assignee logged',
    });
  }
  for (const p of extraction.people ?? []) {
    chips.push({
      type: 'PERSON',
      accent: '#60A5FA',
      label: p,
      sub: extraction.summary ? extraction.summary.slice(0, 50) : 'Mentioned',
    });
  }
  for (const r of extraction.reminders ?? []) {
    chips.push({
      type: 'REMINDER',
      accent: '#A78BFA',
      label: r.text,
      sub: r.time ? new Date(r.time).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : r.urgency,
    });
  }
  for (const i of extraction.ideas ?? []) {
    chips.push({ type: 'IDEA', accent: '#818CF8', label: i.title, sub: i.description.slice(0, 60) });
  }
  if (extraction.mood && extraction.mood.tone !== 'neutral') {
    chips.push({
      type: 'MOOD SIGNAL',
      accent: extraction.mood.tone === 'positive' || extraction.mood.tone === 'excited' ? '#4ADE80'
            : extraction.mood.tone === 'stressed' || extraction.mood.tone === 'frustrated' ? '#FB7185'
            : '#94A3B8',
      label: `${extraction.mood.tone.charAt(0).toUpperCase() + extraction.mood.tone.slice(1)}`,
      sub: `Energy: ${extraction.mood.energy}`,
    });
  }
  return chips.slice(0, 8); // cap to keep the card readable
}

function ExtractionChips({ extraction }: { extraction: import('../types/extraction').ExtractionResult | null }) {
  if (!extraction) return null;
  const chips = buildChips(extraction);
  if (chips.length === 0) return null;
  return (
    <View style={{ marginTop: 10, gap: 5 }}>
      {chips.map((chip, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, borderLeftWidth: 3, borderLeftColor: chip.accent }}>
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: chip.accent, flexShrink: 0 }} />
          <Text style={{ color: LUCY_COLORS.textDark, fontSize: 13, fontWeight: '700', flex: 1 }} numberOfLines={2}>{chip.label}</Text>
        </View>
      ))}
    </View>
  );
}

// ─── Animated organizing indicator ────────────────────────────────────────────

/** Three staggered dots that breathe — replaces static "ORGANIZING" text. */
function OrganizingDots() {
  const dots = [useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current];
  useEffect(() => {
    const anims = dots.map((anim, i) =>
      Animated.loop(Animated.sequence([
        Animated.delay(i * 160),
        Animated.timing(anim, { toValue: 1, duration: 380, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 380, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.delay((2 - i) * 160),
      ]))
    );
    Animated.parallel(anims).start();
    return () => anims.forEach((a) => a.stop());
  }, []);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
      {dots.map((anim, i) => (
        <Animated.View key={i} style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: LUCY_COLORS.primary, opacity: anim.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }), transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1.2] }) }] }} />
      ))}
    </View>
  );
}

// ─── Weekly Life Widget (travel + health) ─────────────────────────────────────

function WeeklyLifeWidget() {
  const [locations, setLocations] = useState<import('../db/locationSnapshots').DayLocationSummary[]>([]);
  const [healthRows, setHealthRows] = useState<import('../db/healthSnapshots').HealthSnapshot[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const db = await getDatabase();
        const [locs, health] = await Promise.all([
          import('../db/locationSnapshots').then((m) => m.listLocationSnapshots(db, 7)),
          import('../db/healthSnapshots').then((m) => m.listHealthSnapshots(db, 7)),
        ]);
        setLocations(locs);
        setHealthRows(health);
      } catch { /* non-critical */ }
    })();
  }, []);

  if (locations.length === 0 && healthRows.length === 0) return null;

  const healthByDate = new Map(healthRows.map((h) => [h.date_key, h]));
  const locationByDate = new Map(locations.map((l) => [l.date_key, l]));

  const last7: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    last7.push(d.toISOString().slice(0, 10));
  }

  const hasTravelData = locations.length > 0;
  const hasHealthData = healthRows.some((h) => h.steps > 0 || h.sleep_hours !== null);
  if (!hasTravelData && !hasHealthData) return null;

  const today = healthByDate.get(last7[0]);
  const { generateHealthTip } = require('../processing/recordLifeContext') as typeof import('../processing/recordLifeContext');
  const tip = today ? generateHealthTip(today.steps, today.sleep_hours, today.resting_hr) : null;

  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const TEAL = '#2DD4BF';

  return (
    <View style={{ marginBottom: 16 }}>
      {tip ? (
        <View style={{ backgroundColor: LUCY_COLORS.surface, borderWidth: 1, borderColor: `${TEAL}44`, borderRadius: 14, padding: 12, marginBottom: 10, borderLeftWidth: 3, borderLeftColor: TEAL }}>
          <Text style={{ color: TEAL, fontSize: 9, fontWeight: '800', letterSpacing: 1.2, marginBottom: 4 }}>HEALTH TIP</Text>
          <Text style={{ color: LUCY_COLORS.textMuted, fontSize: 13, lineHeight: 19 }}>{tip}</Text>
        </View>
      ) : null}

      {(hasTravelData || hasHealthData) ? (
        <>
          <Text style={{ color: TEAL, fontSize: 10, fontWeight: '800', letterSpacing: 1.2, marginBottom: 8 }}>
            YOUR WEEK {hasTravelData ? '· TRAVEL & HEALTH' : '· HEALTH'}
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {last7.map((dateKey) => {
                const loc = locationByDate.get(dateKey);
                const health = healthByDate.get(dateKey);
                const d = new Date(dateKey + 'T12:00:00');
                const dayLabel = dayLabels[d.getDay()];
                const isToday = dateKey === last7[0];

                const hasAnything = (loc && loc.cities.length > 0) || (health && (health.steps > 0 || health.sleep_hours !== null));
                if (!hasAnything && !isToday) return null;

                // Show city or multi-stop label (e.g. "Hyd → Blr")
                const cityLabel = loc && loc.cities.length > 1
                  ? `${loc.cities[0]} → ${loc.cities[loc.cities.length - 1]}`
                  : loc?.firstCity ?? null;

                return (
                  <View key={dateKey} style={{ width: 96, backgroundColor: isToday ? `${TEAL}18` : LUCY_COLORS.surface, borderWidth: 1, borderColor: isToday ? `${TEAL}55` : LUCY_COLORS.border, borderRadius: 12, padding: 10, gap: 4 }}>
                    <Text style={{ color: isToday ? TEAL : LUCY_COLORS.textSubtle, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 }}>
                      {isToday ? 'TODAY' : dayLabel}
                    </Text>
                    {cityLabel ? (
                      <Text style={{ color: LUCY_COLORS.textDark, fontSize: 11, fontWeight: '700' }} numberOfLines={2}>
                        📍 {cityLabel}
                      </Text>
                    ) : null}
                    {health?.sleep_hours ? (
                      <Text style={{ color: LUCY_COLORS.textMuted, fontSize: 11 }}>😴 {health.sleep_hours}h</Text>
                    ) : null}
                    {health?.steps && health.steps > 0 ? (
                      <Text style={{ color: LUCY_COLORS.textMuted, fontSize: 11 }}>
                        {health.steps >= 1000 ? `👟 ${(health.steps / 1000).toFixed(1)}k` : `👟 ${health.steps}`}
                      </Text>
                    ) : null}
                    {!loc && (!health || (health.steps === 0 && !health.sleep_hours)) ? (
                      <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 11 }}>–</Text>
                    ) : null}
                  </View>
                );
              }).filter(Boolean)}
            </View>
          </ScrollView>
        </>
      ) : null}
    </View>
  );
}

// ─── Health View ──────────────────────────────────────────────────────────────

const TEAL = '#2DD4BF';

function HealthMetricCard({ icon, label, value, unit, sub, accent = TEAL }: { icon: string; label: string; value: string | number | null; unit?: string; sub?: string; accent?: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: LUCY_COLORS.border, borderTopColor: '#3A3028', gap: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.22, shadowRadius: 4, elevation: 3 }}>
      <Text style={{ fontSize: 22 }}>{icon}</Text>
      <Text style={{ color: accent, fontSize: 9, fontWeight: '800', letterSpacing: 1.4, textTransform: 'uppercase' }}>{label}</Text>
      {value !== null && value !== undefined ? (
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
          <Text style={{ color: LUCY_COLORS.textDark, fontSize: 26, fontWeight: '900', letterSpacing: -0.5 }}>{value}</Text>
          {unit ? <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 13, fontWeight: '600' }}>{unit}</Text> : null}
        </View>
      ) : (
        <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 14, fontStyle: 'italic' }}>—</Text>
      )}
      {sub ? <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 11, lineHeight: 15 }}>{sub}</Text> : null}
    </View>
  );
}

function HealthTrendBar({ label, value, maxValue, accent }: { label: string; value: number; maxValue: number; accent: string }) {
  const pct = maxValue > 0 ? Math.min(1, value / maxValue) : 0;
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 11 }}>{label}</Text>
        <Text style={{ color: LUCY_COLORS.textMuted, fontSize: 11, fontWeight: '700' }}>{value.toLocaleString()}</Text>
      </View>
      <View style={{ height: 6, backgroundColor: LUCY_COLORS.border, borderRadius: 3, overflow: 'hidden' }}>
        <View style={{ height: 6, width: `${pct * 100}%`, backgroundColor: accent, borderRadius: 3 }} />
      </View>
    </View>
  );
}

// ─── Health: nutrition + Dr. Lucy ───────────────────────────────────────────────
// Premium calorie/macro rings + food logging + the caring guardian, wired to the
// already-built data layer (healthSummary / foodNutrition / healthNutrition / drLucy).

type HealthSummaryT = import('../processing/healthSummary').HealthSummary;
type FoodLogRowT = import('../db/healthNutrition').FoodLogRow;
type GuardianGuidanceT = import('../processing/drLucy').GuardianGuidance;

const MACRO = { protein: '#5BA8FF', carbs: '#F5C451', fat: '#FB7185' } as const;

/**
 * A single SVG progress ring. Calm easing animation on the sweep. value/goal in
 * the same unit; over-goal is clamped visually but never framed as "bad".
 */
function ProgressRing({
  size, stroke, value, goal, color, track = LUCY_COLORS.border, children,
}: { size: number; stroke: number; value: number; goal: number; color: string; track?: string; children?: React.ReactNode }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const pct = goal > 0 ? Math.max(0, Math.min(1, value / goal)) : 0;
  const anim = useRef(new Animated.Value(0)).current;
  const [dash, setDash] = useState(circ);
  useEffect(() => {
    const id = anim.addListener(({ value: v }) => setDash(circ * (1 - v * pct)));
    Animated.timing(anim, { toValue: 1, duration: 850, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    return () => anim.removeListener(id);
  }, [pct, circ]);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
        <SvgCircle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        <SvgCircle
          cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none"
          strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={dash}
        />
      </Svg>
      <View style={{ position: 'absolute', alignItems: 'center', justifyContent: 'center' }}>{children}</View>
    </View>
  );
}

/** A small macro ring with a label + value beneath. */
function MacroRing({ label, value, goal, color }: { label: string; value: number; goal: number; color: string }) {
  return (
    <View style={{ alignItems: 'center', gap: 6, flex: 1 }}>
      <ProgressRing size={66} stroke={7} value={value} goal={goal} color={color}>
        <Text style={{ color: LUCY_COLORS.textDark, fontSize: 14, fontWeight: '900' }}>{value}</Text>
        <Text style={{ color: LUCY_COLORS.textFaint, fontSize: 9, fontWeight: '700' }}>g</Text>
      </ProgressRing>
      <Text style={{ color: color, fontSize: 9.5, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase' }}>{label}</Text>
      <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 10.5 }}>{goal > 0 ? `of ${goal}g` : '—'}</Text>
    </View>
  );
}

const SEVERITY_STYLE: Record<GuardianGuidanceT['severity'], { color: string; label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  care: { color: LUCY_COLORS.primary, label: 'A gentle note', icon: 'heart-outline' },
  gentle: { color: LUCY_COLORS.info, label: 'Something Lucy noticed', icon: 'leaf-outline' },
  caution: { color: LUCY_COLORS.gold, label: 'Worth a glance', icon: 'alert-circle-outline' },
  emergency: { color: LUCY_COLORS.error, label: 'Please take care', icon: 'medkit-outline' },
};

function DrLucyCard({ g }: { g: GuardianGuidanceT }) {
  const s = SEVERITY_STYLE[g.severity] ?? SEVERITY_STYLE.gentle;
  return (
    <View style={{ backgroundColor: LUCY_COLORS.surface, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: LUCY_COLORS.border, borderLeftWidth: 3, borderLeftColor: s.color, gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <Ionicons name={s.icon} size={14} color={s.color} />
        <Text style={{ color: s.color, fontSize: 9.5, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase' }}>{s.label}</Text>
      </View>
      <Text style={{ color: LUCY_COLORS.textDark, fontSize: 14, fontWeight: '600', lineHeight: 20 }}>{g.observation}</Text>
      {g.suggestion ? <Text style={{ color: LUCY_COLORS.textMuted, fontSize: 13, lineHeight: 19 }}>{g.suggestion}</Text> : null}
    </View>
  );
}

// ─── Mood graph (How you've been) ───────────────────────────────────────────
// A premium mood-over-time card: a smooth, valence-coloured area/line chart of the
// daily average mood, a human "you started lifting on X" caption, and tap-a-day to
// read what was happening. Data comes from src/processing/moodGraph.ts (untouched).

const MOOD_UP = LUCY_COLORS.teal;     // warm green/teal — above the line
const MOOD_DOWN = LUCY_COLORS.rose;   // muted rose — below the line
const MOOD_DOMAIN = 2.2;              // y-axis spans −2.2..+2.2 (valence is −2..+2, padded)

/** Friendly one-word read of a tone, for the day sheet's context line. */
function moodWordForTone(tone: string | null): string {
  if (!tone) return 'a quiet day';
  const t = tone.toLowerCase();
  const nice = t.charAt(0).toUpperCase() + t.slice(1);
  return `Mostly ${nice.toLowerCase()}`;
}

/**
 * Build a smooth SVG cubic-bezier `d` from screen points, breaking the line wherever
 * the data has a gap (null day) so we never bridge across missing days. Uses a gentle
 * Catmull-Rom→bezier with clamped tangents so the curve stays calm (no wild overshoot).
 */
function smoothLinePath(pts: Array<{ x: number; y: number } | null>): string {
  let d = '';
  let seg: Array<{ x: number; y: number }> = [];
  const flush = () => {
    if (seg.length === 0) return;
    if (seg.length === 1) { d += ` M ${seg[0].x} ${seg[0].y} l 0.01 0`; seg = []; return; }
    d += ` M ${seg[0].x} ${seg[0].y}`;
    for (let i = 0; i < seg.length - 1; i++) {
      const p0 = seg[i - 1] ?? seg[i];
      const p1 = seg[i];
      const p2 = seg[i + 1];
      const p3 = seg[i + 2] ?? p2;
      const t = 0.16; // tension — lower = tighter to points, calm
      const c1x = p1.x + (p2.x - p0.x) * t;
      const c1y = p1.y + (p2.y - p0.y) * t;
      const c2x = p2.x - (p3.x - p1.x) * t;
      const c2y = p2.y - (p3.y - p1.y) * t;
      d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
    }
    seg = [];
  };
  for (const p of pts) { if (p) seg.push(p); else flush(); }
  flush();
  return d.trim();
}

/** Build the closed area path (line dropped to the baseline) for each continuous run. */
function smoothAreaPath(pts: Array<{ x: number; y: number } | null>, baseY: number): string {
  let d = '';
  let seg: Array<{ x: number; y: number }> = [];
  const flush = () => {
    if (seg.length < 2) { seg = []; return; }
    const line = smoothLinePath(seg);
    d += ` ${line} L ${seg[seg.length - 1].x} ${baseY} L ${seg[0].x} ${baseY} Z`;
    seg = [];
  };
  for (const p of pts) { if (p) seg.push(p); else flush(); }
  flush();
  return d.trim();
}

/** The SVG chart itself — area + valence-gradient line + zero baseline + tappable day columns. */
function MoodChart({
  series, width, turnDate, onPickDay,
}: {
  series: MoodPointT[];
  width: number;
  turnDate: string | null;
  onPickDay: (p: MoodPointT) => void;
}) {
  const H = 132;
  const padX = 6;
  const padTop = 12;
  const padBottom = 14;
  const plotW = Math.max(1, width - padX * 2);
  const plotH = H - padTop - padBottom;
  const n = series.length;

  const xAt = (i: number) => padX + (n <= 1 ? plotW / 2 : (plotW * i) / (n - 1));
  const yAt = (v: number) => padTop + plotH * (1 - (v + MOOD_DOMAIN) / (MOOD_DOMAIN * 2));
  const zeroY = yAt(0);

  const points: Array<{ x: number; y: number } | null> = series.map((p, i) =>
    p.score == null ? null : { x: xAt(i), y: yAt(p.score) },
  );

  const linePath = smoothLinePath(points);
  const areaPath = smoothAreaPath(points, zeroY);

  // Entrance: draw the stroke on, fade the fill in. Stroke draw needs the JS driver
  // (animating strokeDashoffset), matching the existing ProgressRing pattern.
  const draw = useRef(new Animated.Value(0)).current;
  const [dashOffset, setDashOffset] = useState(1);
  const fillFade = useRef(new Animated.Value(0)).current;
  const [fillOpacity, setFillOpacity] = useState(0);
  const LEN = 2000; // generous over-estimate of path length for the draw effect

  useEffect(() => {
    const id1 = draw.addListener(({ value }) => setDashOffset(1 - value));
    const id2 = fillFade.addListener(({ value }) => setFillOpacity(value));
    Animated.parallel([
      Animated.timing(draw, { toValue: 1, duration: 950, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
      Animated.sequence([
        Animated.delay(280),
        Animated.timing(fillFade, { toValue: 1, duration: 600, easing: Easing.out(Easing.quad), useNativeDriver: false }),
      ]),
    ]).start();
    return () => { draw.removeListener(id1); fillFade.removeListener(id2); };
  }, [draw, fillFade, width]);

  const dataPts = series
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.score != null);
  const lastWithData = dataPts.length ? dataPts[dataPts.length - 1] : null;

  return (
    <Svg width={width} height={H}>
      <SvgDefs>
        {/* Stroke + fill split exactly at the zero line: teal above, rose below. */}
        <SvgLinearGradient id="moodStroke" x1="0" y1={padTop} x2="0" y2={H - padBottom} gradientUnits="userSpaceOnUse">
          <SvgStop offset="0" stopColor={MOOD_UP} />
          <SvgStop offset={`${Math.max(0, Math.min(1, (zeroY - padTop) / plotH))}`} stopColor={MOOD_UP} />
          <SvgStop offset={`${Math.max(0, Math.min(1, (zeroY - padTop) / plotH))}`} stopColor={MOOD_DOWN} />
          <SvgStop offset="1" stopColor={MOOD_DOWN} />
        </SvgLinearGradient>
        {/* Area fill mirrors the line: teal fading toward the baseline above 0,
            rose fading toward the baseline below 0. Subtle either way. */}
        <SvgLinearGradient id="moodFill" x1="0" y1={padTop} x2="0" y2={H - padBottom} gradientUnits="userSpaceOnUse">
          <SvgStop offset="0" stopColor={MOOD_UP} stopOpacity="0.28" />
          <SvgStop offset={`${Math.max(0, Math.min(1, (zeroY - padTop) / plotH))}`} stopColor={MOOD_UP} stopOpacity="0.02" />
          <SvgStop offset={`${Math.max(0, Math.min(1, (zeroY - padTop) / plotH))}`} stopColor={MOOD_DOWN} stopOpacity="0.02" />
          <SvgStop offset="1" stopColor={MOOD_DOWN} stopOpacity="0.26" />
        </SvgLinearGradient>
      </SvgDefs>

      {/* Soft area fill (kept subtle; fades in after the line draws). */}
      {areaPath ? (
        <SvgPath d={areaPath} fill="url(#moodFill)" opacity={fillOpacity} />
      ) : null}

      {/* Zero baseline — a quiet dashed line for "neutral". */}
      <SvgLine
        x1={padX} y1={zeroY} x2={width - padX} y2={zeroY}
        stroke={LUCY_COLORS.textFaint} strokeWidth={1} strokeDasharray="2 5" opacity={0.5}
      />

      {/* The mood line, valence-coloured, drawn on entrance. */}
      {linePath ? (
        <SvgPath
          d={linePath}
          stroke="url(#moodStroke)"
          strokeWidth={2.6}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={LEN}
          strokeDashoffset={LEN * dashOffset}
        />
      ) : null}

      {/* Day markers: a dot on each day with data; the turn-day and latest day emphasised. */}
      <SvgG opacity={fillOpacity}>
        {dataPts.map(({ p, i }) => {
          const x = xAt(i);
          const y = yAt(p.score as number);
          const isTurn = turnDate != null && p.date === turnDate;
          const isLast = lastWithData != null && p.date === lastWithData.p.date;
          const color = (p.score as number) >= 0 ? MOOD_UP : MOOD_DOWN;
          if (isTurn) {
            return (
              <SvgG key={p.date}>
                <SvgCircle cx={x} cy={y} r={7} fill={color} opacity={0.18} />
                <SvgCircle cx={x} cy={y} r={4} fill={LUCY_COLORS.surface} stroke={color} strokeWidth={2.4} />
              </SvgG>
            );
          }
          if (isLast) {
            return <SvgCircle key={p.date} cx={x} cy={y} r={3.6} fill={color} stroke={LUCY_COLORS.surface} strokeWidth={1.5} />;
          }
          return <SvgCircle key={p.date} cx={x} cy={y} r={2} fill={color} opacity={0.85} />;
        })}
      </SvgG>

      {/* Invisible, non-overlapping full-height tap columns — every day gets an exact
          tap zone, so tapping near a point reliably opens that day's highlights. */}
      {series.map((p, i) => {
        const colW = width / n;
        return (
          <SvgRect
            key={`hit-${p.date}`}
            x={i * colW}
            y={0}
            width={colW}
            height={H}
            fill="transparent"
            onPress={() => onPickDay(p)}
          />
        );
      })}
    </Svg>
  );
}

/** Bottom sheet: a day's notes, lazily loaded, to find what moved the mood. */
function MoodDaySheet({
  point, onClose,
}: {
  point: MoodPointT | null;
  onClose: () => void;
}) {
  const visible = point != null;
  const [items, setItems] = useState<DayHighlightT[] | null>(null);
  const slide = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(slide, { toValue: 1, tension: 68, friction: 12, useNativeDriver: true }),
        Animated.timing(fade, { toValue: 1, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]).start();
    } else {
      slide.setValue(0); fade.setValue(0);
    }
  }, [visible, slide, fade]);

  // Lazily load highlights only when a day is opened.
  useEffect(() => {
    let alive = true;
    if (!point) { setItems(null); return; }
    setItems(null);
    void (async () => {
      const db = await getDatabase();
      const { getDayHighlights } = await import('../processing/moodGraph');
      const rows = await getDayHighlights(db, point.dayMs);
      if (alive) setItems(rows);
    })();
    return () => { alive = false; };
  }, [point]);

  const translateY = slide.interpolate({ inputRange: [0, 1], outputRange: [340, 0] });
  const accent = point == null ? MOOD_UP : (point.score == null ? LUCY_COLORS.textSubtle : point.score >= 0 ? MOOD_UP : MOOD_DOWN);
  const dateLabel = point ? new Date(point.dayMs).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }) : '';

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={[moodStyles.backdrop, { opacity: fade }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>
      <View style={moodStyles.sheetAnchor} pointerEvents="box-none">
        <Animated.View style={[moodStyles.sheet, { transform: [{ translateY }] }]}>
          <View style={moodStyles.grip} />
          <View style={[moodStyles.accentBar, { backgroundColor: accent }]} />
          <Text style={moodStyles.sheetContext}>{dateLabel}{point ? ` · ${moodWordForTone(point.dominantTone)}` : ''}</Text>
          <Text style={moodStyles.sheetTitle}>What was happening</Text>

          {items == null ? (
            <View style={{ paddingVertical: 28, alignItems: 'center' }}>
              <ActivityIndicator color={LUCY_COLORS.primary} />
            </View>
          ) : items.length === 0 ? (
            <View style={{ paddingVertical: 18 }}>
              <Text style={moodStyles.sheetEmpty}>
                Nothing was captured this day. When you jot or speak a thought, it’ll show up here so you can see what shaped how you felt.
              </Text>
            </View>
          ) : (
            <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingTop: 4 }}>
              {items.map((it) => (
                <View key={it.id} style={moodStyles.noteRow}>
                  <View style={[moodStyles.noteDot, { backgroundColor: accent }]} />
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <Text style={moodStyles.noteTitle} numberOfLines={1}>{it.title}</Text>
                      <Text style={moodStyles.noteTime}>{it.time}</Text>
                    </View>
                    {it.snippet ? <Text style={moodStyles.noteSnippet} numberOfLines={2}>{it.snippet}</Text> : null}
                  </View>
                </View>
              ))}
            </ScrollView>
          )}

          <TouchableOpacity activeOpacity={0.85} style={moodStyles.sheetDone} onPress={onClose}>
            <Text style={moodStyles.sheetDoneText}>Close</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
  );
}

/**
 * The card: "How you've been" — eyebrow, title, a human shift caption (tap → that day),
 * and the chart. Loads its own mood graph; empty state when there are no check-ins yet.
 */
function MoodGraphCard() {
  const [graph, setGraph] = useState<MoodGraphT | null>(null);
  const [width, setWidth] = useState(0);
  const [daySel, setDaySel] = useState<MoodPointT | null>(null);
  const enter = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    void (async () => {
      const db = await getDatabase();
      const { getMoodGraph } = await import('../processing/moodGraph');
      setGraph(await getMoodGraph(db, 30));
    })();
  }, []);

  useEffect(() => {
    if (graph) {
      Animated.timing(enter, { toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }
  }, [graph, enter]);

  if (graph == null) {
    return (
      <View style={[moodStyles.card, { alignItems: 'center', paddingVertical: 30 }]}>
        <ActivityIndicator color={LUCY_COLORS.primary} />
      </View>
    );
  }

  if (!graph.hasData) {
    return (
      <View style={moodStyles.card}>
        <Text style={moodStyles.eyebrow}>HOW YOU’VE BEEN</Text>
        <LucyEmptyState
          compact
          title="I’ll chart your mood here"
          message="As you check in and capture how you’re feeling, I’ll plot it over time — so you can see when things lifted or dipped."
        />
      </View>
    );
  }

  const { series, shift } = graph;
  const turnPoint = shift.sinceDate ? series.find((p) => p.date === shift.sinceDate) ?? null : null;
  const shiftColor = shift.direction === 'up' ? MOOD_UP : shift.direction === 'down' ? MOOD_DOWN : LUCY_COLORS.textSubtle;
  const shiftIcon = shift.direction === 'up' ? 'trending-up' : 'trending-down';
  const monthStart = series[0] ? new Date(series[0].dayMs).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
  const monthEnd = series.length ? new Date(series[series.length - 1].dayMs).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';

  const translateY = enter.interpolate({ inputRange: [0, 1], outputRange: [12, 0] });

  return (
    <Animated.View style={[moodStyles.card, { opacity: enter, transform: [{ translateY }] }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={moodStyles.eyebrow}>HOW YOU’VE BEEN</Text>
        <Text style={moodStyles.range}>Last 30 days</Text>
      </View>
      <Text style={moodStyles.title}>Your mood, lately</Text>

      {/* Human shift caption — the "you started lifting on X" insight. Tap → that day. */}
      {shift.direction !== 'flat' && shift.message ? (
        <TouchableOpacity
          activeOpacity={0.85}
          disabled={turnPoint == null}
          onPress={() => turnPoint && setDaySel(turnPoint)}
          style={[moodStyles.shiftRow, { borderColor: `${shiftColor}33`, backgroundColor: `${shiftColor}12` }]}
        >
          <View style={[moodStyles.shiftChip, { backgroundColor: `${shiftColor}22` }]}>
            <Ionicons name={shiftIcon} size={15} color={shiftColor} />
          </View>
          <Text style={moodStyles.shiftText}>{shift.message}</Text>
          {turnPoint ? <Ionicons name="chevron-forward" size={16} color={LUCY_COLORS.textSubtle} /> : null}
        </TouchableOpacity>
      ) : null}

      {/* Chart */}
      <View style={{ marginTop: 4 }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {width > 0 ? (
          <MoodChart series={series} width={width} turnDate={shift.sinceDate} onPickDay={setDaySel} />
        ) : (
          <View style={{ height: 132 }} />
        )}
      </View>

      {/* Footer: range + a quiet hint at the interaction. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
        <Text style={moodStyles.axis}>{monthStart}</Text>
        <Text style={moodStyles.hint}>Tap a day to see what was happening</Text>
        <Text style={moodStyles.axis}>{monthEnd}</Text>
      </View>

      <MoodDaySheet point={daySel} onClose={() => setDaySel(null)} />
    </Animated.View>
  );
}

const moodStyles = StyleSheet.create({
  card: {
    backgroundColor: LUCY_COLORS.surface,
    borderRadius: 22,
    padding: 18,
    borderWidth: 1,
    borderColor: LUCY_COLORS.border,
    gap: 8,
  },
  eyebrow: { color: LUCY_COLORS.primaryGlow, fontSize: 10, fontWeight: '900', letterSpacing: 1.4 },
  range: { color: LUCY_COLORS.textFaint, fontSize: 11, fontWeight: '700' },
  title: { color: LUCY_COLORS.textDark, fontSize: 18, fontWeight: '900', letterSpacing: -0.3 },
  shiftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 11,
    paddingHorizontal: 12,
    marginTop: 4,
    marginBottom: 2,
  },
  shiftChip: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  shiftText: { flex: 1, color: LUCY_COLORS.textMuted, fontSize: 13, lineHeight: 18.5, fontWeight: '600' },
  axis: { color: LUCY_COLORS.textFaint, fontSize: 10.5, fontWeight: '700' },
  hint: { color: LUCY_COLORS.textFaint, fontSize: 10.5, fontWeight: '600', fontStyle: 'italic' },

  // Day sheet
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheetAnchor: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: LUCY_COLORS.surfaceSheet,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderWidth: 1,
    borderColor: LUCY_COLORS.border,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 30,
    shadowColor: LUCY_COLORS.primary,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 18,
    elevation: 12,
  },
  grip: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: LUCY_COLORS.border, marginBottom: 14 },
  accentBar: { width: 36, height: 3, borderRadius: 2, marginBottom: 10 },
  sheetContext: { color: LUCY_COLORS.primaryGlow, fontSize: 11, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 4 },
  sheetTitle: { color: LUCY_COLORS.textDark, fontSize: 21, fontWeight: '900', letterSpacing: -0.2, marginBottom: 6 },
  sheetEmpty: { color: LUCY_COLORS.textMuted, fontSize: 13.5, lineHeight: 20 },
  noteRow: {
    flexDirection: 'row',
    gap: 11,
    backgroundColor: LUCY_COLORS.surfaceRaised,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: LUCY_COLORS.border,
    padding: 12,
  },
  noteDot: { width: 7, height: 7, borderRadius: 3.5, marginTop: 5 },
  noteTitle: { flex: 1, color: LUCY_COLORS.textDark, fontSize: 14, fontWeight: '800' },
  noteTime: { color: LUCY_COLORS.textSubtle, fontSize: 11.5, fontWeight: '700' },
  noteSnippet: { color: LUCY_COLORS.textMuted, fontSize: 12.5, lineHeight: 18, marginTop: 3 },
  sheetDone: {
    marginTop: 16,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: LUCY_COLORS.surfaceRaised,
    borderWidth: 1,
    borderColor: LUCY_COLORS.border,
  },
  sheetDoneText: { color: LUCY_COLORS.textDark, fontSize: 15, fontWeight: '800' },
});

/** Today's meal items grouped by meal_type, each deletable. */
const MEAL_ORDER = ['breakfast', 'lunch', 'dinner', 'snack'];
const MEAL_META: Record<string, { label: string; icon: string }> = {
  breakfast: { label: 'Breakfast', icon: '🌅' },
  lunch: { label: 'Lunch', icon: '🥗' },
  dinner: { label: 'Dinner', icon: '🍽️' },
  snack: { label: 'Snacks', icon: '🍎' },
};

function MealTimeline({ items, onDelete }: { items: FoodLogRowT[]; onDelete: (id: number) => void }) {
  const groups = new Map<string, FoodLogRowT[]>();
  for (const it of items) {
    const key = (it.meal_type && MEAL_META[it.meal_type]) ? it.meal_type : 'snack';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(it);
  }
  const ordered = MEAL_ORDER.filter((k) => groups.has(k));
  if (ordered.length === 0) return null;
  return (
    <View style={{ gap: 12 }}>
      {ordered.map((key) => {
        const rows = groups.get(key)!;
        const meta = MEAL_META[key];
        const cals = rows.reduce((s, r) => s + (r.calories ?? 0), 0);
        return (
          <View key={key} style={{ backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: LUCY_COLORS.border, gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontSize: 16 }}>{meta.icon}</Text>
                <Text style={{ color: LUCY_COLORS.textDark, fontSize: 14, fontWeight: '800', letterSpacing: 0.3 }}>{meta.label}</Text>
              </View>
              <Text style={{ color: LUCY_COLORS.textMuted, fontSize: 13, fontWeight: '800' }}>{Math.round(cals)} kcal</Text>
            </View>
            {rows.map((r) => (
              <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: LUCY_COLORS.textDark, fontSize: 13.5, fontWeight: '600' }} numberOfLines={1}>
                    {r.name}{r.qty ? ` · ${r.qty}${r.unit ? ' ' + r.unit : ''}` : ''}
                  </Text>
                  <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 11 }}>
                    {r.calories ?? 0} kcal{r.protein_g != null ? ` · P ${r.protein_g}` : ''}{r.carbs_g != null ? ` · C ${r.carbs_g}` : ''}{r.fat_g != null ? ` · F ${r.fat_g}` : ''}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => onDelete(r.id)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="close-circle-outline" size={20} color={LUCY_COLORS.textSubtle} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}

const ACTIVITY_OPTS: Array<{ key: import('../processing/calorieEngine').ActivityLevel; label: string; hint: string }> = [
  { key: 'sedentary', label: 'Sedentary', hint: 'Little movement' },
  { key: 'light', label: 'Light', hint: '1–2 days active' },
  { key: 'moderate', label: 'Moderate', hint: '3–4 days active' },
  { key: 'active', label: 'Active', hint: '5–6 days active' },
  { key: 'very_active', label: 'Very active', hint: 'Daily / physical job' },
];
const GOAL_OPTS: Array<{ key: import('../processing/calorieEngine').GoalKind; label: string }> = [
  { key: 'lose', label: 'Lose weight' },
  { key: 'maintain', label: 'Maintain' },
  { key: 'gain', label: 'Gain weight' },
];

/** Small onboarding sheet to capture the body profile → goals auto-derive on save. */
function BodyProfileSheet({ visible, initial, onClose, onSaved }: {
  visible: boolean;
  initial: import('../db/healthNutrition').BodyProfileRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [sex, setSex] = useState<import('../processing/calorieEngine').Sex>(initial?.sex ?? 'female');
  const [birthYear, setBirthYear] = useState(initial?.birth_year ? String(initial.birth_year) : '');
  const [heightCm, setHeightCm] = useState(initial?.height_cm ? String(initial.height_cm) : '');
  const [weightKg, setWeightKg] = useState(initial?.weight_kg ? String(initial.weight_kg) : '');
  const [activity, setActivity] = useState<import('../processing/calorieEngine').ActivityLevel>(initial?.activity_level ?? 'moderate');
  const [goal, setGoal] = useState<import('../processing/calorieEngine').GoalKind>(initial?.goal ?? 'maintain');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setSex(initial?.sex ?? 'female');
    setBirthYear(initial?.birth_year ? String(initial.birth_year) : '');
    setHeightCm(initial?.height_cm ? String(initial.height_cm) : '');
    setWeightKg(initial?.weight_kg ? String(initial.weight_kg) : '');
    setActivity(initial?.activity_level ?? 'moderate');
    setGoal(initial?.goal ?? 'maintain');
  }, [visible, initial]);

  const valid = !!birthYear && !!heightCm && !!weightKg
    && Number(birthYear) > 1900 && Number(heightCm) > 50 && Number(weightKg) > 20;

  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      const db = await getDatabase();
      const { upsertBodyProfile } = await import('../db/healthNutrition');
      await upsertBodyProfile(db, {
        sex, birth_year: Number(birthYear), height_cm: Number(heightCm), weight_kg: Number(weightKg),
        activity_level: activity, goal,
      });
      onSaved();
      onClose();
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const pill = (active: boolean) => ({
    paddingVertical: 9, paddingHorizontal: 14, borderRadius: 999, minHeight: 44, justifyContent: 'center' as const,
    backgroundColor: active ? LUCY_COLORS.primarySoft : LUCY_COLORS.surfaceRaised,
    borderWidth: 1, borderColor: active ? LUCY_COLORS.primary : LUCY_COLORS.border,
  });
  const pillText = (active: boolean) => ({ color: active ? LUCY_COLORS.primaryGlow : LUCY_COLORS.textMuted, fontSize: 13, fontWeight: '700' as const });

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' }} onPress={onClose}>
        <Pressable onPress={(e) => e.stopPropagation()} style={{ backgroundColor: LUCY_COLORS.surfaceSheet, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderWidth: 1, borderColor: LUCY_COLORS.border, maxHeight: '90%' }}>
          <View style={{ alignItems: 'center', paddingTop: 10 }}>
            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: LUCY_COLORS.border }} />
          </View>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} keyboardShouldPersistTaps="handled">
            <View style={{ gap: 4 }}>
              <Text style={{ color: LUCY_COLORS.primaryGlow, fontSize: 10, fontWeight: '900', letterSpacing: 1.2 }}>SET UP YOUR PROFILE</Text>
              <Text style={{ color: LUCY_COLORS.textDark, fontSize: 21, fontWeight: '900' }}>A few details, then I’ll tailor your day</Text>
              <Text style={{ color: LUCY_COLORS.textMuted, fontSize: 13, lineHeight: 19 }}>This stays on your device. It lets me estimate your energy and set gentle, realistic goals.</Text>
            </View>

            <View style={{ gap: 8 }}>
              <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 11, fontWeight: '800', letterSpacing: 0.8 }}>SEX</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {(['female', 'male'] as const).map((s) => (
                  <TouchableOpacity key={s} style={[pill(sex === s), { flex: 1, alignItems: 'center' }]} onPress={() => setSex(s)}>
                    <Text style={pillText(sex === s)}>{s === 'female' ? 'Female' : 'Male'}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={{ flexDirection: 'row', gap: 10 }}>
              {[
                { label: 'BIRTH YEAR', v: birthYear, set: setBirthYear, ph: '1995' },
                { label: 'HEIGHT (CM)', v: heightCm, set: setHeightCm, ph: '170' },
                { label: 'WEIGHT (KG)', v: weightKg, set: setWeightKg, ph: '65' },
              ].map((f) => (
                <View key={f.label} style={{ flex: 1, gap: 6 }}>
                  <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 11, fontWeight: '800', letterSpacing: 0.8 }}>{f.label}</Text>
                  <TextInput
                    value={f.v} onChangeText={f.set} placeholder={f.ph} placeholderTextColor={LUCY_COLORS.textFaint}
                    keyboardType="number-pad"
                    style={{ backgroundColor: LUCY_COLORS.surfaceRaised, borderWidth: 1, borderColor: LUCY_COLORS.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, color: LUCY_COLORS.textDark, fontSize: 16, fontWeight: '700' }}
                  />
                </View>
              ))}
            </View>

            <View style={{ gap: 8 }}>
              <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 11, fontWeight: '800', letterSpacing: 0.8 }}>ACTIVITY</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {ACTIVITY_OPTS.map((o) => (
                  <TouchableOpacity key={o.key} style={pill(activity === o.key)} onPress={() => setActivity(o.key)}>
                    <Text style={pillText(activity === o.key)}>{o.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={{ gap: 8 }}>
              <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 11, fontWeight: '800', letterSpacing: 0.8 }}>GOAL</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {GOAL_OPTS.map((o) => (
                  <TouchableOpacity key={o.key} style={[pill(goal === o.key), { flex: 1, alignItems: 'center' }]} onPress={() => setGoal(o.key)}>
                    <Text style={pillText(goal === o.key)}>{o.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
              <TouchableOpacity onPress={onClose} style={{ flex: 1, paddingVertical: 14, borderRadius: 14, borderWidth: 1, borderColor: LUCY_COLORS.border, alignItems: 'center' }}>
                <Text style={{ color: LUCY_COLORS.textMuted, fontSize: 14, fontWeight: '700' }}>Later</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={save} disabled={!valid || saving} style={{ flex: 2, paddingVertical: 14, borderRadius: 14, backgroundColor: valid ? LUCY_COLORS.primary : LUCY_COLORS.surfaceElevated, alignItems: 'center', opacity: valid ? 1 : 0.6 }}>
                {saving ? <ActivityIndicator color={LUCY_COLORS.background} /> : <Text style={{ color: valid ? LUCY_COLORS.background : LUCY_COLORS.textSubtle, fontSize: 14, fontWeight: '900' }}>Save & set my goals</Text>}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function HealthView() {
  const [health7, setHealth7] = useState<import('../db/healthSnapshots').HealthSnapshot[]>([]);
  const [mood7, setMood7] = useState<Array<{ tone: string; created_at: string }>>([]);
  // Nutrition + guardian state (additive to the original activity view).
  const [summary, setSummary] = useState<HealthSummaryT | null>(null);
  const [profileRow, setProfileRow] = useState<import('../db/healthNutrition').BodyProfileRow | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [mealText, setMealText] = useState('');
  const [quickFoods, setQuickFoods] = useState<string[]>([]); // one-tap re-log chips (frequent foods)
  const [quickBusy, setQuickBusy] = useState<string | null>(null); // chip being logged (double-tap guard)
  const [logging, setLogging] = useState(false);          // text/voice logging spinner
  const [reading, setReading] = useState(false);          // photo vision spinner
  const [netExpanded, setNetExpanded] = useState(false);  // ED-safe: net trend is opt-in
  // Designed feedback (replaces Alert.alert): an informational sheet + a transient success toast.
  const [sheet, setSheet] = useState<{ title: string; message?: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const refreshNutrition = async () => {
    const db = await getDatabase();
    const { getHealthSummary } = await import('../processing/healthSummary');
    const { getBodyProfile } = await import('../db/healthNutrition');
    const [s, p] = await Promise.all([getHealthSummary(db), getBodyProfile(db)]);
    setSummary(s);
    setProfileRow(p);
    try { const { getFrequentFoods } = await import('../db/healthNutrition'); setQuickFoods(await getFrequentFoods(db, 6)); } catch { /* non-critical */ }
  };

  // One-tap re-log of a frequent food. Local food DB resolves common foods instantly (no AI wait),
  // so no spinner — just a brief per-chip pressed/disabled state to swallow double-taps.
  const logQuick = async (name: string) => {
    if (quickBusy) return;
    setQuickBusy(name);
    try {
      const db = await getDatabase();
      const { logFoodFromText } = await import('../processing/foodNutrition');
      await logFoodFromText(db, name);
      await refreshNutrition();
      setToast('Logged ' + name);
    } catch (e) {
      setSheet({ title: 'Could not log', message: e instanceof Error ? e.message : 'Please try again.' });
    } finally {
      setQuickBusy(null);
    }
  };

  const logText = async () => {
    const text = mealText.trim();
    if (!text || logging) return;
    setLogging(true);
    try {
      const db = await getDatabase();
      const { getModelKeyStatus, modelKeyMissingMessage } = await import('../ai/provider');
      const status = await getModelKeyStatus();
      if (status.remote && !status.keyPresent) { setLogging(false); setSheet({ title: 'Add your API key', message: modelKeyMissingMessage(status) }); return; }
      const { logFoodFromText } = await import('../processing/foodNutrition');
      const res = await logFoodFromText(db, text);
      setMealText('');
      if (!res.estimated) {
        setSheet({ title: 'Saved your meal', message: 'I couldn\'t estimate the calories from that. Name the foods and rough amounts — like "2 eggs and toast" — and I\'ll add a calorie count. (Estimates use remote intelligence — add a key in Settings.)' });
      } else {
        setToast('Meal logged');
      }
      await refreshNutrition();
    } catch (e) {
      setSheet({ title: 'Could not log', message: e instanceof Error ? e.message : 'Please try again.' });
    } finally {
      setLogging(false);
    }
  };

  const logPhoto = async () => {
    if (reading) return;
    try {
      const { pickImage } = await import('../processing/imageCapture');
      const uri = await pickImage('Snap a meal', 'I’ll read the photo and estimate the foods and calories.');
      if (!uri) return;
      const { getModelKeyStatus, modelKeyMissingMessage } = await import('../ai/provider');
      const status = await getModelKeyStatus();
      if (status.remote && !status.keyPresent) {
        setSheet({ title: 'Add your API key', message: modelKeyMissingMessage(status) });
        return;
      }
      setReading(true);
      const db = await getDatabase();
      const { logFoodFromPhoto } = await import('../processing/foodNutrition');
      const res = await logFoodFromPhoto(db, uri);
      setReading(false);
      if (!res.estimated) {
        setSheet({ title: 'Saved your meal', message: 'I couldn\'t make out the food well enough to estimate calories. Try a clearer, well-lit photo from above, or type what it was.' });
      } else {
        setToast('Meal logged');
      }
      await refreshNutrition();
    } catch (e) {
      setReading(false);
      setSheet({ title: 'Could not read meal', message: e instanceof Error ? e.message : 'Please try again.' });
    }
  };

  const removeFood = async (id: number) => {
    try {
      const db = await getDatabase();
      const { deleteFoodLog } = await import('../db/healthNutrition');
      await deleteFoodLog(db, id);
      await refreshNutrition();
    } catch { /* non-critical */ }
  };

  useEffect(() => {
    void (async () => {
      const db = await getDatabase();
      const [h, m] = await Promise.all([
        import('../db/healthSnapshots').then((mod) => mod.listHealthSnapshots(db, 7)),
        db.getAllAsync<{ tone: string; created_at: string }>(
          `SELECT tone, created_at FROM mood_entries WHERE created_at >= datetime('now', '-7 days') ORDER BY created_at DESC`
        ),
      ]);
      setHealth7(h);
      setMood7(m);
    })();
    void refreshNutrition();
  }, []);

  const today = health7[0] ?? null;
  const maxSteps = Math.max(10000, ...health7.map((h) => h.steps));
  const avgSteps = health7.length > 0 ? Math.round(health7.reduce((s, h) => s + h.steps, 0) / health7.length) : 0;
  const avgSleep = health7.filter((h) => h.sleep_hours).length > 0
    ? Math.round(health7.filter((h) => h.sleep_hours).reduce((s, h) => s + (h.sleep_hours ?? 0), 0) / health7.filter((h) => h.sleep_hours).length * 10) / 10
    : null;

  // Mood distribution
  const moodCount = mood7.reduce<Record<string, number>>((acc, m) => { acc[m.tone] = (acc[m.tone] ?? 0) + 1; return acc; }, {});
  const dominantMood = Object.entries(moodCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const moodEmoji: Record<string, string> = { positive: '😊', excited: '⚡', calm: '😌', neutral: '😐', stressed: '😤', frustrated: '😤', negative: '😔' };

  // Health tip
  const { generateHealthTip } = require('../processing/recordLifeContext') as typeof import('../processing/recordLifeContext');
  const tip = today ? generateHealthTip(today.steps, today.sleep_hours, today.resting_hr) : null;

  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const last7Keys: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    last7Keys.push(d.toISOString().slice(0, 10));
  }
  const healthByDate = new Map(health7.map((h) => [h.date_key, h]));

  const goals = summary?.goals ?? null;
  const intake = summary?.intake ?? null;
  const calGoal = goals?.calorie_goal ?? 0;
  const calEaten = intake?.calories ?? 0;
  const calRemaining = summary?.remaining;
  const drLucy = summary?.drLucy ?? [];

  return (
    <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, gap: 16 }}>
      {/* ── Today header: profile setup OR calories-remaining ring + macro rings ── */}
      {summary && !summary.profileComplete ? (
        <TouchableOpacity activeOpacity={0.9} onPress={() => setShowProfile(true)}
          style={{ backgroundColor: LUCY_COLORS.surface, borderRadius: 20, padding: 18, borderWidth: 1, borderColor: LUCY_COLORS.primaryLine, gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: LUCY_COLORS.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="sparkles-outline" size={20} color={LUCY_COLORS.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: LUCY_COLORS.primaryGlow, fontSize: 10, fontWeight: '900', letterSpacing: 1.2 }}>LET’S PERSONALISE THIS</Text>
              <Text style={{ color: LUCY_COLORS.textDark, fontSize: 17, fontWeight: '900' }}>Set up your profile</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={LUCY_COLORS.textSubtle} />
          </View>
          <Text style={{ color: LUCY_COLORS.textMuted, fontSize: 13, lineHeight: 19 }}>
            A few details (kept on your device) let me estimate your energy and set gentle calorie + macro goals.
          </Text>
        </TouchableOpacity>
      ) : summary ? (
        <View style={{ backgroundColor: LUCY_COLORS.surface, borderRadius: 22, padding: 18, borderWidth: 1, borderColor: LUCY_COLORS.border, gap: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ color: LUCY_COLORS.primaryGlow, fontSize: 10, fontWeight: '900', letterSpacing: 1.4 }}>TODAY’S ENERGY</Text>
            <TouchableOpacity onPress={() => setShowProfile(true)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="settings-outline" size={16} color={LUCY_COLORS.textSubtle} />
            </TouchableOpacity>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
            <ProgressRing size={132} stroke={13} value={calEaten} goal={calGoal || 1} color={LUCY_COLORS.primary}>
              <Text style={{ color: LUCY_COLORS.textDark, fontSize: 30, fontWeight: '900', letterSpacing: -1 }}>
                {calGoal > 0 ? Math.max(0, calRemaining ?? 0) : calEaten}
              </Text>
              <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 11, fontWeight: '700' }}>{calGoal > 0 ? 'kcal left' : 'kcal eaten'}</Text>
            </ProgressRing>
            <View style={{ flex: 1, gap: 8 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 12 }}>Eaten</Text>
                <Text style={{ color: LUCY_COLORS.textDark, fontSize: 13, fontWeight: '800' }}>{calEaten} kcal</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 12 }}>Goal</Text>
                <Text style={{ color: LUCY_COLORS.textDark, fontSize: 13, fontWeight: '800' }}>{calGoal > 0 ? `${calGoal} kcal` : '—'}</Text>
              </View>
              {summary.energy.tdee ? (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 12 }}>Burned (est.)</Text>
                  <Text style={{ color: LUCY_COLORS.textMuted, fontSize: 13, fontWeight: '800' }}>{summary.energy.tdee} kcal</Text>
                </View>
              ) : null}
            </View>
          </View>

          {/* Macro mini-rings */}
          {goals ? (
            <View style={{ flexDirection: 'row', gap: 6, paddingTop: 4, borderTopWidth: 1, borderTopColor: LUCY_COLORS.divider }}>
              <MacroRing label="Protein" value={intake?.protein_g ?? 0} goal={goals.protein_g} color={MACRO.protein} />
              <MacroRing label="Carbs" value={intake?.carbs_g ?? 0} goal={goals.carbs_g} color={MACRO.carbs} />
              <MacroRing label="Fat" value={intake?.fat_g ?? 0} goal={goals.fat_g} color={MACRO.fat} />
            </View>
          ) : null}

          {/* ED-safe net-calorie trend — quiet, opt-in, framed as a trend not a verdict */}
          {summary.net_rolling_7 != null ? (
            <View style={{ borderTopWidth: 1, borderTopColor: LUCY_COLORS.divider, paddingTop: 10 }}>
              <TouchableOpacity onPress={() => setNetExpanded((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 12, fontWeight: '700' }}>Energy balance trend</Text>
                <Ionicons name={netExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={LUCY_COLORS.textSubtle} />
              </TouchableOpacity>
              {netExpanded ? (
                <Text style={{ color: LUCY_COLORS.textMuted, fontSize: 12.5, lineHeight: 18, marginTop: 6 }}>
                  Over the last 7 days you’ve averaged about {summary.net_rolling_7 >= 0 ? '+' : ''}{summary.net_rolling_7} kcal vs what you burn. This is a rough trend (±15–25%), not a daily score — a gentle direction, nothing to chase.
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : (
        <View style={{ backgroundColor: LUCY_COLORS.surface, borderRadius: 22, padding: 24, alignItems: 'center' }}>
          <ActivityIndicator color={LUCY_COLORS.primary} />
        </View>
      )}

      {/* ── How you've been: mood over time (headline wellbeing signal) ── */}
      <MoodGraphCard />

      {/* ── Log food ── */}
      {summary && summary.profileComplete ? (
        <View style={{ gap: 10 }}>
          <Text style={{ color: LUCY_COLORS.primaryGlow, fontSize: 10, fontWeight: '900', letterSpacing: 1.4 }}>LOG A MEAL</Text>
          {/* Quick add — one-tap re-log of frequent foods (Indian home meals repeat daily) */}
          {quickFoods.length > 0 ? (
            <View style={{ gap: 8 }}>
              <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 11, fontWeight: '700', letterSpacing: 0.3 }}>Quick add</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ gap: 8, paddingRight: 4 }}
              >
                {quickFoods.map((name) => {
                  const busy = quickBusy === name;
                  return (
                    <TouchableOpacity
                      key={name}
                      activeOpacity={0.7}
                      disabled={!!quickBusy}
                      onPress={() => { void logQuick(name); }}
                      style={{
                        flexDirection: 'row', alignItems: 'center', gap: 6,
                        paddingVertical: 9, paddingHorizontal: 14,
                        borderRadius: 999,
                        backgroundColor: busy ? LUCY_COLORS.primarySoft : LUCY_COLORS.primaryMist,
                        borderWidth: 1, borderColor: LUCY_COLORS.primaryLine,
                        opacity: quickBusy && !busy ? 0.45 : 1,
                      }}
                    >
                      <Ionicons name={busy ? 'checkmark' : 'add'} size={15} color={LUCY_COLORS.primaryGlow} />
                      <Text style={{ color: LUCY_COLORS.textDark, fontSize: 13, fontWeight: '700' }} numberOfLines={1}>{name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity onPress={logPhoto} disabled={reading}
              style={{ flex: 1, minHeight: 44, backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 16, borderWidth: 1, borderColor: LUCY_COLORS.border, padding: 14, alignItems: 'center', gap: 6 }}>
              {reading ? <ActivityIndicator color={LUCY_COLORS.primary} /> : <Ionicons name="camera-outline" size={22} color={LUCY_COLORS.primary} />}
              <Text style={{ color: LUCY_COLORS.textDark, fontSize: 13, fontWeight: '800' }}>{reading ? 'Reading…' : 'Snap a meal'}</Text>
            </TouchableOpacity>
            <View style={{ flex: 2, backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 16, borderWidth: 1, borderColor: LUCY_COLORS.border, padding: 12, gap: 8 }}>
              <TextInput
                value={mealText} onChangeText={setMealText}
                placeholder="Say or type a meal — “2 eggs and toast”"
                placeholderTextColor={LUCY_COLORS.textFaint}
                style={{ color: LUCY_COLORS.textDark, fontSize: 14, minHeight: 22 }}
                onSubmitEditing={logText} returnKeyType="done" multiline
              />
              <TouchableOpacity onPress={logText} disabled={!mealText.trim() || logging}
                style={{ minHeight: 40, borderRadius: 12, backgroundColor: mealText.trim() ? LUCY_COLORS.primary : LUCY_COLORS.surfaceElevated, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, opacity: mealText.trim() ? 1 : 0.6 }}>
                {logging ? <ActivityIndicator color={LUCY_COLORS.background} /> : <Ionicons name="add" size={18} color={mealText.trim() ? LUCY_COLORS.background : LUCY_COLORS.textSubtle} />}
                <Text style={{ color: mealText.trim() ? LUCY_COLORS.background : LUCY_COLORS.textSubtle, fontSize: 13, fontWeight: '900' }}>{logging ? 'Estimating…' : 'Log'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : null}

      {/* ── Meal timeline ── */}
      {intake && intake.items.length > 0 ? (
        <View style={{ gap: 10 }}>
          <Text style={{ color: LUCY_COLORS.primaryGlow, fontSize: 10, fontWeight: '900', letterSpacing: 1.4 }}>TODAY’S MEALS</Text>
          <MealTimeline items={intake.items} onDelete={removeFood} />
        </View>
      ) : summary && summary.profileComplete ? (
        <View style={{ backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 16, padding: 18, borderWidth: 1, borderColor: LUCY_COLORS.border, alignItems: 'center', gap: 6 }}>
          <Text style={{ fontSize: 24 }}>🍵</Text>
          <Text style={{ color: LUCY_COLORS.textDark, fontSize: 14, fontWeight: '700' }}>Nothing logged yet today</Text>
          <Text style={{ color: LUCY_COLORS.textMuted, fontSize: 12.5, textAlign: 'center', lineHeight: 18 }}>Snap or describe a meal above and I’ll keep a gentle running tally.</Text>
        </View>
      ) : null}

      {/* ── Activity & energy (original metrics, expanded with BMR/TDEE) ── */}
      <Text style={{ color: TEAL, fontSize: 10, fontWeight: '800', letterSpacing: 1.4, marginBottom: 4, marginTop: 4 }}>ACTIVITY & ENERGY</Text>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <HealthMetricCard
          icon="👟"
          label="Steps"
          value={today?.steps && today.steps > 0 ? (today.steps >= 1000 ? `${(today.steps / 1000).toFixed(1)}k` : today.steps) : null}
          sub={avgSteps > 0 ? `7-day avg: ${avgSteps >= 1000 ? `${(avgSteps / 1000).toFixed(1)}k` : avgSteps}` : undefined}
        />
        <HealthMetricCard
          icon="😴"
          label="Sleep"
          value={today?.sleep_hours ?? null}
          unit="h"
          sub={avgSleep ? `7-day avg: ${avgSleep}h` : undefined}
          accent="#818CF8"
        />
        <HealthMetricCard
          icon="❤️"
          label="HR"
          value={today?.resting_hr ?? null}
          unit="bpm"
          accent="#FB7185"
        />
      </View>

      {/* Energy estimates (BMR / TDEE / active) — labelled estimated, never precise truth */}
      {summary && summary.profileComplete && summary.energy.bmr ? (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <HealthMetricCard icon="🔥" label="BMR" value={summary.energy.bmr} unit="kcal" sub="At rest" accent={LUCY_COLORS.primary} />
          <HealthMetricCard icon="⚡" label="Burned" value={summary.energy.tdee ?? null} unit="kcal" sub="Estimated total" accent={LUCY_COLORS.gold} />
          <HealthMetricCard icon="🏃" label="Active" value={summary.activity.active_energy_kcal ?? null} unit="kcal" sub={summary.activity.active_energy_source === 'measured' ? 'Measured' : 'Estimated'} accent={TEAL} />
        </View>
      ) : null}

      {/* Health tip */}
      {tip ? (
        <View style={{ backgroundColor: LUCY_COLORS.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: `${TEAL}44`, borderLeftWidth: 3, borderLeftColor: TEAL }}>
          <Text style={{ color: TEAL, fontSize: 9, fontWeight: '800', letterSpacing: 1.4, marginBottom: 4 }}>HEALTH TIP</Text>
          <Text style={{ color: LUCY_COLORS.textMuted, fontSize: 14, lineHeight: 21 }}>{tip}</Text>
        </View>
      ) : null}

      {/* 7-day steps trend */}
      {health7.some((h) => h.steps > 0) ? (
        <View style={{ backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: LUCY_COLORS.border, gap: 12 }}>
          <Text style={{ color: TEAL, fontSize: 10, fontWeight: '800', letterSpacing: 1.4 }}>STEPS — LAST 7 DAYS</Text>
          {last7Keys.map((dateKey) => {
            const h = healthByDate.get(dateKey);
            const d = new Date(dateKey + 'T12:00:00');
            const isToday = dateKey === last7Keys[6];
            return (
              <HealthTrendBar
                key={dateKey}
                label={isToday ? 'Today' : dayLabels[d.getDay()]}
                value={h?.steps ?? 0}
                maxValue={maxSteps}
                accent={h && h.steps >= 10000 ? '#4ADE80' : h && h.steps >= 5000 ? TEAL : '#60A5FA'}
              />
            );
          })}
          <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 11, marginTop: 4 }}>Goal: 10,000 steps</Text>
        </View>
      ) : null}

      {/* Weekly travel + health context (moved here from Focus Now per user). */}
      <WeeklyLifeWidget />

      {/* Sleep 7-day */}
      {health7.some((h) => h.sleep_hours) ? (
        <View style={{ backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: LUCY_COLORS.border, gap: 12 }}>
          <Text style={{ color: '#818CF8', fontSize: 10, fontWeight: '800', letterSpacing: 1.4 }}>SLEEP — LAST 7 DAYS</Text>
          {last7Keys.map((dateKey) => {
            const h = healthByDate.get(dateKey);
            const d = new Date(dateKey + 'T12:00:00');
            const isToday = dateKey === last7Keys[6];
            const hrs = h?.sleep_hours ?? 0;
            return (
              <HealthTrendBar
                key={dateKey}
                label={isToday ? 'Today' : dayLabels[d.getDay()]}
                value={Math.round(hrs * 10) / 10}
                maxValue={10}
                accent={hrs >= 8 ? '#4ADE80' : hrs >= 6 ? '#818CF8' : '#FB7185'}
              />
            );
          })}
          <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 11, marginTop: 4 }}>Goal: 8h sleep</Text>
        </View>
      ) : null}

      {/* Mood correlation */}
      {dominantMood ? (
        <View style={{ backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: LUCY_COLORS.border, gap: 8 }}>
          <Text style={{ color: '#C084FC', fontSize: 10, fontWeight: '800', letterSpacing: 1.4 }}>MOOD THIS WEEK</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={{ fontSize: 28 }}>{moodEmoji[dominantMood] ?? '😐'}</Text>
            <View>
              <Text style={{ color: LUCY_COLORS.textDark, fontSize: 16, fontWeight: '700' }}>{dominantMood.charAt(0).toUpperCase() + dominantMood.slice(1)}</Text>
              <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 12 }}>{mood7.length} mood entries this week</Text>
            </View>
          </View>
          {Object.entries(moodCount).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([tone, count]) => (
            <HealthTrendBar key={tone} label={tone} value={count} maxValue={mood7.length} accent="#C084FC" />
          ))}
        </View>
      ) : null}

      {/* ── Dr. Lucy — the caring guardian ── */}
      {drLucy.length > 0 ? (
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
            <Ionicons name="medkit-outline" size={14} color={LUCY_COLORS.primary} />
            <Text style={{ color: LUCY_COLORS.primaryGlow, fontSize: 10, fontWeight: '900', letterSpacing: 1.4 }}>DR. LUCY</Text>
          </View>
          {drLucy.map((g, i) => <DrLucyCard key={`${g.category}-${i}`} g={g} />)}
          <Text style={{ color: LUCY_COLORS.textFaint, fontSize: 11, lineHeight: 16, paddingHorizontal: 2 }}>{DR_LUCY_DISCLAIMER_TEXT}</Text>
        </View>
      ) : null}

      {/* No data empty state */}
      {!today && health7.length === 0 ? (
        <View style={{ alignItems: 'center', paddingVertical: 48, gap: 12 }}>
          <View style={{ alignItems: 'center', justifyContent: 'center', width: 80, height: 80 }}>
            <View style={{ position: 'absolute', width: 80, height: 80, borderRadius: 40, backgroundColor: `${TEAL}10` }} />
            <View style={{ position: 'absolute', width: 52, height: 52, borderRadius: 26, backgroundColor: `${TEAL}18` }} />
            <Text style={{ fontSize: 28 }}>💚</Text>
          </View>
          <Text style={{ color: LUCY_COLORS.textDark, fontSize: 17, fontWeight: '700' }}>Health tracking will appear here</Text>
          <Text style={{ color: LUCY_COLORS.textMuted, fontSize: 14, textAlign: 'center', lineHeight: 21, maxWidth: 280 }}>
            Enable Location in Connectors to start. Steps and sleep data come from your device — no extra setup needed.
          </Text>
        </View>
      ) : null}

      <View style={{ height: 20 }} />

      <BodyProfileSheet
        visible={showProfile}
        initial={profileRow}
        onClose={() => setShowProfile(false)}
        onSaved={() => { void refreshNutrition(); }}
      />
      <ActionSheet
        visible={!!sheet}
        onClose={() => setSheet(null)}
        title={sheet?.title ?? ''}
        message={sheet?.message}
        actions={[{ label: 'Got it', style: 'primary' }]}
        cancelLabel={null}
      />
      <Toast visible={!!toast} message={toast ?? ''} onHide={() => setToast(null)} />
    </ScrollView>
  );
}

// ─── Brain Pulse ──────────────────────────────────────────────────────────────

const PULSE_ACCENT = '#C084FC'; // violet — distinct from all existing palette colors

function PulseCard({ pulse, onDismiss }: { pulse: import('../db/brainPulses').BrainPulseRow; onDismiss: () => void }) {
  const accentMap: Record<string, string> = {
    pattern: PULSE_ACCENT,
    person: '#60A5FA',
    mood: '#F59E0B',
    connection: '#4ADE80',
    overdue: '#FB7185',
  };
  const labelMap: Record<string, string> = {
    pattern: 'PATTERN',
    person: 'PATTERN · PEOPLE',
    mood: 'PATTERN · MOOD',
    connection: 'CONNECTION',
    overdue: 'HEADS UP',
  };
  const accent = accentMap[pulse.category] ?? PULSE_ACCENT;
  const label = labelMap[pulse.category] ?? 'PULSE';
  const age = (() => {
    const ms = Date.now() - new Date(pulse.generated_at.includes('T') ? pulse.generated_at : `${pulse.generated_at.replace(' ', 'T')}Z`).getTime();
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return h > 0 ? `${h}h ago` : `${m}m ago`;
  })();
  return (
    <View style={{ backgroundColor: LUCY_COLORS.surface, borderWidth: 1, borderColor: '#2D1F40', borderRadius: 18, padding: 14, marginBottom: 10, borderLeftWidth: 3, borderLeftColor: accent, opacity: pulse.seen_at ? 0.78 : 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <Text style={{ color: accent, fontSize: 9, fontWeight: '800', letterSpacing: 1.2 }}>{label}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 11 }}>{age}</Text>
          {/* Viral share button — shares the insight as plain text, no raw data */}
          <TouchableOpacity
            onPress={async () => {
              try {
                const { shareAsync, isAvailableAsync } = await import('expo-sharing');
                const shareText = `LUCY noticed: "${pulse.headline}" — captured by my second brain`;
                if (await isAvailableAsync()) {
                  // Write to a temp file since expo-sharing needs a URI on some platforms
                  const fs = await import('expo-file-system/legacy');
                  const writeAsStringAsync = (fs as unknown as { writeAsStringAsync: (uri: string, contents: string) => Promise<void> }).writeAsStringAsync;
                  const cacheDirectory = (fs as unknown as { cacheDirectory: string }).cacheDirectory ?? '';
                  const uri = `${cacheDirectory}lucy-pulse.txt`;
                  await writeAsStringAsync(uri, shareText);
                  await shareAsync(uri, { mimeType: 'text/plain', dialogTitle: 'Share LUCY insight' });
                }
              } catch { /* non-critical */ }
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={{ color: accent, fontSize: 13, fontWeight: '700' }}>↗</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onDismiss} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 14, fontWeight: '700' }}>✕</Text>
          </TouchableOpacity>
        </View>
      </View>
      <Text style={{ color: LUCY_COLORS.textDark, fontSize: 14, fontWeight: '600', lineHeight: 21 }}>{pulse.headline}</Text>
    </View>
  );
}

function BrainPulseSection() {
  const [pulses, setPulses] = useState<import('../db/brainPulses').BrainPulseRow[]>([]);
  const [showArchive, setShowArchive] = useState(false);
  const [archived, setArchived] = useState<import('../db/brainPulses').BrainPulseRow[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const db = await getDatabase();
        const { listUnseenPulses, markPulseSeen } = await import('../db/brainPulses');
        const rows = await listUnseenPulses(db);
        setPulses(rows);
        for (const p of rows.filter((r) => !r.seen_at)) {
          await markPulseSeen(db, p.id);
        }
      } catch { /* non-critical */ }
    })();
  }, []);

  const dismiss = async (id: number) => {
    const db = await getDatabase();
    const { dismissPulse } = await import('../db/brainPulses');
    await dismissPulse(db, id);
    setPulses((prev) => prev.filter((p) => p.id !== id));
  };

  const openArchive = async () => {
    const db = await getDatabase();
    const { listDismissedPulses } = await import('../db/brainPulses');
    setArchived(await listDismissedPulses(db));
    setShowArchive(true);
  };

  return (
    <>
      {pulses.length > 0 ? (
        <View style={{ marginBottom: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <Text style={{ color: PULSE_ACCENT, fontSize: 10, fontWeight: '800', letterSpacing: 1.2 }}>LUCY PULSE</Text>
            <View style={{ backgroundColor: PULSE_ACCENT, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 }}>
              <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>{pulses.filter((p) => !p.seen_at).length || pulses.length}</Text>
            </View>
          </View>
          {pulses.map((p) => (
            <PulseCard key={p.id} pulse={p} onDismiss={() => void dismiss(p.id)} />
          ))}
          <TouchableOpacity onPress={() => void openArchive()} style={{ alignSelf: 'flex-start', marginBottom: 8 }}>
            <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 12 }}>View archived pulses</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Archive modal */}
      <Modal transparent animationType="fade" visible={showArchive} onRequestClose={() => setShowArchive(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setShowArchive(false)}>
          <Pressable style={[styles.feedbackModal, { maxHeight: '80%', gap: 0 }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <Text style={{ color: PULSE_ACCENT, fontSize: 13, fontWeight: '800', letterSpacing: 1 }}>ARCHIVED PULSES</Text>
              <TouchableOpacity onPress={() => setShowArchive(false)}>
                <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 14, fontWeight: '700' }}>Done</Text>
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              {archived.length === 0
                ? <Text style={{ color: LUCY_COLORS.textSubtle, textAlign: 'center', padding: 24 }}>No archived pulses yet.</Text>
                : archived.map((p) => (
                    <View key={p.id} style={{ opacity: 0.6, marginBottom: 10, borderLeftWidth: 2, borderLeftColor: PULSE_ACCENT, paddingLeft: 10 }}>
                      <Text style={{ color: LUCY_COLORS.textDark, fontSize: 13, fontWeight: '600' }}>{p.headline}</Text>
                      <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 11, marginTop: 2 }}>
                        {new Date(p.generated_at.includes('T') ? p.generated_at : `${p.generated_at.replace(' ', 'T')}Z`).toLocaleDateString()}
                      </Text>
                    </View>
                  ))
              }
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
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
  stalenessReviews = [],
  contextBatch = null,
  onStalenessResolved,
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
  stalenessReviews?: StalenessReview[];
  contextBatch?: ContextBatch | null;
  onStalenessResolved?: () => void;
}) {
  const moodEmoji: Record<string, string> = { positive: '😊', excited: '⚡', calm: '😌', neutral: '😐', stressed: '😤', frustrated: '😤', negative: '😔' };
  const moodColor: Record<string, string> = { positive: '#4ADE80', excited: '#FFA05C', calm: '#60A5FA', neutral: LUCY_COLORS.textSubtle, stressed: '#F59E0B', frustrated: '#FB7185', negative: '#FB7185' };
  const organizing = captures.filter((item) => captureStatus(item) !== 'complete').length;
  const nowMs = Date.now();
  const STALE_MS = 4 * 60 * 60 * 1000; // 4h past due = stale
  const scheduledReminders = reminders.filter((item) => {
    if (!item.remind_at) return false;
    return new Date(item.remind_at).getTime() > nowMs - STALE_MS;
  });
  const staleReminders = reminders.filter((item) => {
    if (!item.remind_at) return false;
    return new Date(item.remind_at).getTime() <= nowMs - STALE_MS;
  });
  const unscheduledCount = reminders.length - scheduledReminders.length - staleReminders.length;

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
      {/* Brain Pulse — 6-hour cross-domain insight synthesis */}
      <BrainPulseSection />

      {/* Staleness reviews — shown before Follow-ups so the user cleans house first */}
      {stalenessReviews.length > 0 ? (
        <>
          <SectionTitle title="Quick Review" count={stalenessReviews.length} />
          {stalenessReviews.map((review) => (
            <StalenessReviewCard
              key={review.id}
              review={review}
              onDone={() => onStalenessResolved?.()}
            />
          ))}
        </>
      ) : null}

      {/* Commitment guardian — promises to keep + things owed; at-risk ranks above generic follow-ups. */}
      <CommitmentsSection onChange={onLoopResolved} />

      {followUps.length > 0 ? (
        <>
          <SectionTitle title="Follow-ups" count={followUps.length} />
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
      <SectionTitle title="Reminders" count={scheduledReminders.length || undefined} />
      {scheduledReminders.length ? scheduledReminders.map((item) => <ReminderCard item={item} key={item.id} />) : <EmptyLine text="No scheduled reminders yet." />}
      {unscheduledCount ? <Text style={styles.pendingHint}>{unscheduledCount} captured reminder{unscheduledCount === 1 ? '' : 's'} need a specific time.</Text> : null}
      <SectionTitle title="Focus" count={todos.length || undefined} />
      {todos.length ? todos.map((item) => <FocusTodoCard key={item.id} item={item} />) : (
        <LucyEmptyState
          compact
          title="Nothing on your plate"
          message="Capture a task by voice or text and I'll line it up here for you."
        />
      )}

      {/* Needs Context — moved to bottom so it doesn't clutter the main focus.
          Shows only when there are unanswered clarification requests. */}
      {contextCount > 0 && !contextBatch ? (
        <View style={{ marginTop: 10 }}>
          <SectionTitle title="Needs Context" />
          <TouchableOpacity style={styles.contextPrompt} onPress={onOpenContext}>
            <Text style={styles.contextPromptTitle}>
              {contextCount > 5
                ? `${contextCount} memories could be clearer — tap to answer one`
                : `${contextCount} memory detail${contextCount === 1 ? '' : 's'} could become clearer`}
            </Text>
            <Text style={styles.tonightDetail}>Add context when you have time — LUCY folds your answer into that memory and re-organizes it.</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      {contextBatch ? (
        <View style={{ marginTop: 10 }}>
          <SectionTitle title="Needs Context" />
          <ContextBatchCard batch={contextBatch} onDone={() => onStalenessResolved?.()} />
        </View>
      ) : null}
    </ScrollView>
  );
}

export function NeedsContextView({
  requests,
  onAnswered,
}: {
  requests: ContextRequestRow[];
  onAnswered: () => void;
}) {
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [proposals, setProposals] = useState<import('../db/memoryUpdateProposals').MemoryUpdateProposalRow[]>([]);
  const [feedbackOpen, setFeedbackOpen] = useState<Record<number, boolean>>({});
  const [feedbackText, setFeedbackText] = useState<Record<number, string>>({});
  const [entityProps, setEntityProps] = useState<import('../db/entityEditProposals').EntityEditProposalRow[]>([]);

  const loadProposals = async () => {
    const db = await getDatabase();
    const { listOpenMemoryUpdateProposals } = await import('../db/memoryUpdateProposals');
    setProposals(await listOpenMemoryUpdateProposals(db));
    const { listOpenEntityEditProposals } = await import('../db/entityEditProposals');
    setEntityProps(await listOpenEntityEditProposals(db));
  };
  useEffect(() => { void loadProposals(); }, [requests.length]);

  const applyEntityProp = async (id: number) => {
    const db = await getDatabase();
    const { applyEntityEditProposal } = await import('../db/entityEditProposals');
    await applyEntityEditProposal(db, id);
    setEntityProps((p) => p.filter((x) => x.id !== id));
    onAnswered();
  };
  const dismissEntityProp = async (id: number) => {
    const db = await getDatabase();
    const { setEntityEditProposalStatus } = await import('../db/entityEditProposals');
    await setEntityEditProposalStatus(db, id, 'dismissed');
    setEntityProps((p) => p.filter((x) => x.id !== id));
    onAnswered();
  };

  // Self-improving brain (propose-and-confirm): apply folds the context into the OLD note + re-extracts.
  const applyProposal = async (id: number) => {
    const db = await getDatabase();
    const { applyMemoryUpdateProposal } = await import('../processing/proposeMemoryUpdates');
    await applyMemoryUpdateProposal(db, id);
    setProposals((p) => p.filter((x) => x.id !== id));
    onAnswered();
  };
  const dismissProposal = async (id: number) => {
    const db = await getDatabase();
    const { setMemoryUpdateProposalStatus } = await import('../db/memoryUpdateProposals');
    await setMemoryUpdateProposalStatus(db, id, 'dismissed');
    setProposals((p) => p.filter((x) => x.id !== id));
  };
  // "No, that's wrong" — reject the proposal AND teach LUCY the correction so it sticks and isn't
  // re-suggested (the opposite of silently accepting a bad change).
  const rejectProposal = async (id: number) => {
    const note = (feedbackText[id] ?? '').trim();
    const db = await getDatabase();
    if (note) {
      try {
        const { upsertLearnedFact } = await import('../db/learnedProfile');
        await upsertLearnedFact(db, 'correction', note, 'feedback');
      } catch { /* non-fatal */ }
    }
    const { setMemoryUpdateProposalStatus } = await import('../db/memoryUpdateProposals');
    await setMemoryUpdateProposalStatus(db, id, 'dismissed');
    setProposals((p) => p.filter((x) => x.id !== id));
    setFeedbackOpen((f) => ({ ...f, [id]: false }));
    setFeedbackText((f) => ({ ...f, [id]: '' }));
    onAnswered();
  };

  const rememberContext = async (request: ContextRequestRow) => {
    const answer = (answers[request.id] ?? '').trim();
    if (!answer) {
      return;
    }
    const db = await getDatabase();
    await answerContextRequest(db, request.id, answer);
    // Make the answer actually CORRECT the brain: append it to the source capture as a marked
    // addendum (original words preserved) and re-extract, so anything mis-stored / mis-linked /
    // mis-understood is re-derived with the new context — not just filed as a side "clarification".
    if (request.capture_id) {
      try {
        const cap = await db.getFirstAsync<{ raw_transcript: string | null }>(
          'SELECT raw_transcript FROM captures WHERE id = ?', request.capture_id,
        );
        const base = (cap?.raw_transcript ?? '').trim();
        const q = (request.question || 'clarification').replace(/\s+/g, ' ').trim();
        const addendum = `\n\n[Added context — ${q}: ${answer}]`;
        await db.runAsync('UPDATE captures SET raw_transcript = ? WHERE id = ?', base + addendum, request.capture_id);
        const { resetCaptureForReprocess } = await import('../db/captures');
        await resetCaptureForReprocess(db, request.capture_id);
        const { processQueue } = await import('../processing/extract');
        void processQueue();
      } catch { /* non-fatal — the organize below still records the clarification */ }
    }
    await organizeMemory(db, 'clarification');
    setAnswers((existing) => ({ ...existing, [request.id]: '' }));
    onAnswered();
  };

  // One card per item, rendered one-at-a-time in a full-screen swipeable deck (proposals first).
  const deckCards: ReviewCard[] = [
    ...entityProps.map((p) => ({
      key: `ent-${p.id}`,
      render: () => (
        <View>
          <Text style={styles.contextLucyLabel}>this looks related to a project —</Text>
          <Text style={styles.contextQuestion}>Add this note to “{p.project_name ?? 'a project'}”?</Text>
          {p.suggested_text ? <Text style={styles.contextSnippet} numberOfLines={5}>{protectedPreview(p.suggested_text)}</Text> : null}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
            <TouchableOpacity style={[styles.contextButton, { flex: 1 }]} onPress={() => void applyEntityProp(p.id)}>
              <Text style={styles.contextButtonText}>Add to project</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.contextButton, styles.contextButtonDisabled, { flex: 0, paddingHorizontal: 18 }]} onPress={() => void dismissEntityProp(p.id)}>
              <Text style={styles.contextButtonText}>Skip</Text>
            </TouchableOpacity>
          </View>
        </View>
      ),
    })),
    ...proposals.map((p) => ({
      key: `prop-${p.id}`,
      render: () => (
        <View>
          <Text style={styles.contextLucyLabel}>{p.kind === 'correction' ? 'i think this corrects an earlier note —' : 'i can enrich an earlier note —'}</Text>
          <Text style={styles.contextQuestion}>{p.summary}</Text>
          {(p.old_created_at || p.old_title) ? (
            <Text style={styles.contextSource}>
              Earlier note{p.old_created_at ? ` · ${new Date(`${String(p.old_created_at).replace(' ', 'T')}Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}{p.old_title ? ` · ${p.old_title}` : ''}
            </Text>
          ) : null}
          {p.old_excerpt ? <Text style={styles.contextSnippet} numberOfLines={4}>Old: "{protectedPreview(p.old_excerpt)}"</Text> : null}
          <Text style={[styles.contextSnippet, { color: LUCY_COLORS.primaryGlow }]} numberOfLines={4}>Add: {protectedPreview(p.suggested_context)}</Text>
          {feedbackOpen[p.id] ? (
            <>
              <TextInput
                multiline
                placeholder="What's actually right? (e.g. it's 'AD groups' — Azure AD, not 'AB')"
                placeholderTextColor={LUCY_COLORS.textSubtle}
                style={styles.contextInput}
                value={feedbackText[p.id] ?? ''}
                onChangeText={(v) => setFeedbackText((f) => ({ ...f, [p.id]: v }))}
              />
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                <TouchableOpacity style={[styles.contextButton, { flex: 1 }]} onPress={() => void rejectProposal(p.id)}>
                  <Text style={styles.contextButtonText}>Send feedback & discard</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.contextButton, styles.contextButtonDisabled, { flex: 0, paddingHorizontal: 16 }]} onPress={() => setFeedbackOpen((f) => ({ ...f, [p.id]: false }))}>
                  <Text style={styles.contextButtonText}>Back</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              <TouchableOpacity style={[styles.contextButton, { flex: 1 }]} onPress={() => void applyProposal(p.id)}>
                <Text style={styles.contextButtonText}>Apply</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.contextButton, styles.contextButtonDisabled, { flex: 1 }]} onPress={() => setFeedbackOpen((f) => ({ ...f, [p.id]: true }))}>
                <Text style={styles.contextButtonText}>No, that's wrong</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.contextButton, styles.contextButtonDisabled, { flex: 0, paddingHorizontal: 14 }]} onPress={() => void dismissProposal(p.id)}>
                <Text style={styles.contextButtonText}>Skip</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      ),
    })),
    ...requests.map((request) => ({
      key: `req-${request.id}`,
      render: () => (
        <View>
          <Text style={styles.contextLucyLabel}>hey, quick question —</Text>
          <Text style={styles.contextQuestion}>
            {request.question || 'Can you add any context that might help me organize this memory?'}
          </Text>
          {(request.source_created_at || request.source_title) ? (
            <Text style={styles.contextSource}>
              From your note{request.source_created_at ? ` · ${new Date(`${String(request.source_created_at).replace(' ', 'T')}Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}{request.source_title ? ` · ${request.source_title}` : ''}
            </Text>
          ) : null}
          {(request.source_excerpt || request.snippet) ? (
            <Text style={styles.contextSnippet} numberOfLines={5}>You said: "{protectedPreview(request.source_excerpt || request.snippet || '')}"</Text>
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
      ),
    })),
  ];

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 140 : 80}>
      <ReviewCardDeck
        cards={deckCards}
        emptyText="Nothing needs clarification right now. LUCY will ask only when extra context can help."
        emptyNode={(
          <LucyEmptyState
            title="All clear"
            message="Nothing needs clarification right now. I'll only ask when a little context helps me help you."
          />
        )}
        header={(
          <View style={[styles.contextIntro, { paddingHorizontal: 18 }]}>
            <Text style={styles.eyebrow}>CONNECT</Text>
            <Text style={styles.tonightTitle}>Needs Context</Text>
            <Text style={styles.tonightDetail}>One at a time — swipe through. Your answers stay in encrypted local memory.</Text>
          </View>
        )}
      />
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
  onAskAbout,
}: {
  captures: CaptureRow[];
  moodsByCapture: Record<number, string>;
  onFeedback: () => void;
  onQueued?: () => void;
  onAskAbout?: (question: string) => void;
}) {
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [feedbackTarget, setFeedbackTarget] = useState<CaptureRow | null>(null);
  const [feedbackText, setFeedbackText] = useState('');
  const [sending, setSending] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<CaptureRow[] | null>(null);
  const [noteTypeFilter, setNoteTypeFilter] = useState<string | null>(null); // null = all
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [quickText, setQuickText] = useState('');
  const [quickSending, setQuickSending] = useState(false);
  const pendingReceiptImage = useRef<string | null>(null); // persisted receipt photo to attach on next quick send
  const [quickAck, setQuickAck] = useState('');
  const [readingImage, setReadingImage] = useState(false); // vision OCR in progress (snap-a-note)
  const [viewerImage, setViewerImage] = useState<string | null>(null); // original photo being viewed
  const [pendingAction, setPendingAction] = useState<import('../processing/automationEngine').ExtractedAction | null>(null);
  const [executingAction, setExecutingAction] = useState(false);
  const [menuTarget, setMenuTarget] = useState<CaptureRow | null>(null);
  // LLM-detected actions: map from capture_id → parsed action object
  const [llmActions, setLlmActions] = useState<Record<number, import('../processing/automationEngine').ExtractedAction>>({});
  // Extraction chips: map from capture_id → parsed ExtractionResult (loaded lazily on expand)
  const [extractionChips, setExtractionChips] = useState<Record<number, import('../types/extraction').ExtractionResult>>({});
  // note_type badges loaded eagerly for all visible captures (single cheap JSON parse)
  const [noteTypes, setNoteTypes] = useState<Record<number, string>>({});
  // Designed confirm/info sheet + success toast — replaces Alert.alert across the timeline.
  const [confirmSheet, setConfirmSheet] = useState<{
    context?: string; title: string; message?: string; accent?: string;
    actions: SheetAction[]; cancelLabel?: string | null;
  } | null>(null);
  const [tlToast, setTlToast] = useState<string | null>(null);

  const runReprocess = async (capture: CaptureRow) => {
    const db = await getDatabase();
    // Purge previously-extracted items first so reprocessing can't leave duplicates.
    const { resetCaptureForReprocess } = await import('../db/captures');
    await resetCaptureForReprocess(db, capture.id);
    onFeedback();
  };

  const reprocessCapture = async (capture: CaptureRow) => {
    // A large / multi-event entry re-runs as MANY AI calls (segmentation + one per event),
    // which costs credits. Warn before a single tap can fan out into a big spend.
    const len = capture.raw_transcript?.length ?? 0;
    if (len > 600) {
      setConfirmSheet({
        context: 'Long entry',
        title: 'Reprocess this entry?',
        message: 'This looks like a long or multi-event entry. Reprocessing re-runs AI extraction and may make several API calls (one per event), which uses credits.',
        actions: [{ label: 'Reprocess', style: 'destructive', onPress: () => void runReprocess(capture) }],
      });
      return;
    }
    await runReprocess(capture);
  };

  const confirmDeleteCapture = (capture: CaptureRow) => {
    setConfirmSheet({
      context: 'From your timeline',
      title: 'Delete memory?',
      message: 'This thought will be permanently removed from your timeline.',
      accent: LUCY_COLORS.error,
      actions: [{
        label: 'Delete', style: 'destructive',
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
      }],
    });
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

  // Load LLM-detected actions + note_types from DB whenever captures change.
  useEffect(() => {
    void (async () => {
      try {
        const db = await getDatabase();
        // LLM action cards
        const rows = await db.getAllAsync<{ capture_id: number; action_json: string }>(
          'SELECT capture_id, action_json FROM pending_actions',
        );
        const map: Record<number, import('../processing/automationEngine').ExtractedAction> = {};
        for (const row of rows) {
          try {
            const parsed = JSON.parse(row.action_json) as import('../processing/automationEngine').ExtractedAction;
            if (parsed.type && parsed.displayText) {
              map[row.capture_id] = { ...parsed, confidence: 0.95 };
            }
          } catch { /* skip malformed */ }
        }
        setLlmActions(map);
        // Eagerly load note_type for all visible captures — single cheap query,
        // so the IDEA/THOUGHT/JOURNAL badge shows without needing to expand the card.
        if (captures.length > 0) {
          const ids = captures.filter((c) => c.processed === 1).map((c) => c.id);
          if (ids.length > 0) {
            const eRows = await db.getAllAsync<{ capture_id: number; structured_json: string }>(
              `SELECT e.capture_id, e.structured_json FROM extractions e
               INNER JOIN (SELECT capture_id, MAX(id) AS eid FROM extractions GROUP BY capture_id) latest
               ON latest.eid = e.id
               WHERE e.capture_id IN (${ids.map(() => '?').join(',')})`,
              ...ids,
            );
            const ntMap: Record<number, string> = {};
            for (const r of eRows) {
              try {
                const p = JSON.parse(r.structured_json) as { note_type?: string };
                if (p.note_type) ntMap[r.capture_id] = p.note_type;
              } catch { /* skip */ }
            }
            setNoteTypes(ntMap);
          }
        }
      } catch { /* non-critical */ }
    })();
  }, [captures]);

  // Apply note-type filter using eagerly-loaded noteTypes map
  const baseCaptures = searchResults ?? captures;
  const displayCaptures = noteTypeFilter
    ? baseCaptures.filter((c) => noteTypes[c.id] === noteTypeFilter)
    : baseCaptures;
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
      // If the feedback reads like a general instruction about how LUCY should behave
      // ("always keep it short", "don't add tasks", "I prefer…"), remember it as a
      // durable learned fact so future AI calls honour it.
      const fb = feedbackText.trim();
      if (/\b(always|never|don'?t|do not|stop|please keep|i prefer|i like|i hate|make sure|from now on|in future|going forward|remember to)\b/i.test(fb)) {
        try {
          const { upsertLearnedFact } = await import('../db/learnedProfile');
          await upsertLearnedFact(db, /\b(don'?t|do not|stop|never)\b/i.test(fb) ? 'correction' : 'preference', fb, 'feedback');
        } catch { /* non-critical */ }
      }
      setFeedbackTarget(null); setFeedbackText(''); onFeedback();
    } finally { setSending(false); }
  };

  const sendQuick = async () => {
    const t = quickText.trim();
    if (!t || quickSending) return;
    // A receipt scan (if any) to attach to this capture; consume now so it can't carry to a later one.
    const receiptImg = pendingReceiptImage.current; pendingReceiptImage.current = null;

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
      const capId = await enqueueTranscript(t, 'text', false);
      if (receiptImg && capId) {
        try { const db = await getDatabase(); const { setCaptureSourceImage } = await import('../db/captures'); await setCaptureSourceImage(db, capId, receiptImg); } catch { /* image link optional */ }
      }
      setQuickText('');
      setQuickAck('Got it ✓');
      setTimeout(() => setQuickAck(''), 2000);
      onQueued?.();
    } catch { /* non-critical */ } finally { setQuickSending(false); }
  };

  return (
    <View style={{ flex: 1 }}>
      {/* Reading-image overlay — the vision OCR takes a couple seconds; show progress so the user
          knows LUCY is working on the photo rather than wondering if the tap registered. */}
      <Modal visible={readingImage} transparent animationType="fade" onRequestClose={() => {}}>
        <View style={styles.readingOverlay}>
          <View style={styles.readingCard}>
            <ActivityIndicator size="large" color={LUCY_COLORS.primary} />
            <Text style={styles.readingText}>Reading your image…</Text>
            <Text style={styles.readingSubText}>Pulling out the text and key details</Text>
          </View>
        </View>
      </Modal>
      {/* Original-photo viewer — the source-of-truth image, tap anywhere to close */}
      <Modal visible={!!viewerImage} transparent animationType="fade" onRequestClose={() => setViewerImage(null)}>
        <Pressable style={styles.imageViewerBackdrop} onPress={() => setViewerImage(null)}>
          {viewerImage ? <Image source={{ uri: viewerImage }} style={styles.imageViewerImg} resizeMode="contain" /> : null}
          <Text style={styles.imageViewerHint}>Tap to close · original photo</Text>
        </Pressable>
      </Modal>
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
        {/* Snap an image — receipt (expense) or any note/document → stored as memory */}
        <TouchableOpacity
          style={styles.tlReceiptBtn}
          onPress={() => {
            Alert.alert('Snap an image', 'What are you capturing?', [
              {
                text: '🧾 Receipt (expense)',
                onPress: async () => {
                  const { scanReceiptToText } = await import('../processing/receiptScan');
                  const scanned = await scanReceiptToText();
                  if (scanned) { setQuickText(scanned.text); pendingReceiptImage.current = scanned.imagePath; }
                },
              },
              {
                text: '📝 Note / document / image',
                onPress: async () => {
                  const { getModelKeyStatus, modelKeyMissingMessage } = await import('../ai/provider');
                  const status = await getModelKeyStatus();
                  if (status.remote && !status.keyPresent) { setConfirmSheet({ title: 'Add your API key', message: modelKeyMissingMessage(status), actions: [{ label: 'Got it', style: 'primary' }], cancelLabel: null }); return; }
                  const { snapImageToMemory } = await import('../processing/imageCapture');
                  try {
                    const ok = await snapImageToMemory(setReadingImage);
                    if (ok) onQueued?.();
                  } finally {
                    setReadingImage(false);
                  }
                },
              },
              { text: 'Cancel', style: 'cancel' },
            ]);
          }}
        >
          <Ionicons name="camera-outline" size={18} color={LUCY_COLORS.textMuted} />
        </TouchableOpacity>
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

      {/* stickyHeaderIndices={[0]} makes chips stick to top when scrolling.
          Chips are always at index 0; when noteTypes is empty they have height:0 so they're invisible. */}
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false} stickyHeaderIndices={Object.keys(noteTypes).length > 0 ? [0] : []}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ height: Object.keys(noteTypes).length > 0 ? 34 : 0, marginBottom: Object.keys(noteTypes).length > 0 ? 8 : 0, backgroundColor: LUCY_COLORS.background }}
          contentContainerStyle={{ paddingHorizontal: 2, gap: 6, flexDirection: 'row', alignItems: 'center' }}
        >
          {(['all', 'thought', 'task', 'idea', 'journal', 'meeting', 'reminder'] as const).map((type) => {
            const isAll = type === 'all';
            const isActive = isAll ? !noteTypeFilter : noteTypeFilter === type;
            const nt = isAll ? null : noteTypeLabel(type as import('../types/extraction').NoteType);
            return (
              <TouchableOpacity
                key={type}
                style={{ alignSelf: 'center', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 12, borderWidth: 1, borderColor: isActive ? (nt?.color ?? LUCY_COLORS.primary) : LUCY_COLORS.border, backgroundColor: isActive ? `${nt?.color ?? LUCY_COLORS.primary}18` : 'transparent' }}
                onPress={() => setNoteTypeFilter(isAll ? null : noteTypeFilter === type ? null : type)}
              >
                <Text style={{ color: isActive ? (nt?.color ?? LUCY_COLORS.primary) : LUCY_COLORS.textSubtle, fontSize: 11, fontWeight: '700' }}>
                  {isAll ? 'All' : nt?.label ?? type}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        {groups.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 60, paddingHorizontal: 40, gap: 14 }}>
            {/* AmberPulse — three concentric circles, LUCY is listening */}
            <View style={{ alignItems: 'center', justifyContent: 'center', width: 80, height: 80, marginBottom: 4 }}>
              <View style={{ position: 'absolute', width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(255,140,66,0.06)' }} />
              <View style={{ position: 'absolute', width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(255,140,66,0.10)' }} />
              <View style={{ position: 'absolute', width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,140,66,0.16)' }} />
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: LUCY_COLORS.primary }} />
            </View>
            {noteTypeFilter ? (
              <>
                <Text style={{ color: LUCY_COLORS.textDark, fontSize: 17, fontWeight: '700', textAlign: 'center' }}>
                  No {noteTypeFilter}s yet
                </Text>
                <Text style={{ color: LUCY_COLORS.textMuted, fontSize: 14, lineHeight: 21, textAlign: 'center' }}>
                  Capture something and LUCY will classify it as a {noteTypeFilter} if it fits.
                </Text>
              </>
            ) : (
              <>
                <Text style={{ color: LUCY_COLORS.textDark, fontSize: 17, fontWeight: '700', textAlign: 'center' }}>Nothing yet today</Text>
                <Text style={{ color: LUCY_COLORS.textMuted, fontSize: 14, lineHeight: 21, textAlign: 'center' }}>Speak a thought or type something. LUCY handles the rest.</Text>
              </>
            )}
          </View>
        ) : groups.map((group, gi) => {
          // Flat index across all groups so the entrance cascade is continuous down the page;
          // capped inside FadeInUp's delay below so a long timeline never has a sluggish tail.
          const groupBase = groups.slice(0, gi).reduce((n, g) => n + g.items.length, 0);
          return (
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
              // Cap the cascade at 8 items (~440ms) so later cards just fade in promptly.
              const enterDelay = Math.min(groupBase + idx, 8) * 55;

              return (
                <FadeInUp key={item.id} delay={enterDelay}>
                <TouchableOpacity
                  style={styles.tlRow}
                  onPress={() => {
                    const nowExpanded = !expanded[item.id];
                    setExpanded((prev) => ({ ...prev, [item.id]: nowExpanded }));
                    // Lazily load extraction chips the first time a processed card expands
                    if (nowExpanded && item.processed === 1 && !extractionChips[item.id]) {
                      void (async () => {
                        try {
                          const db = await getDatabase();
                          const { getLatestExtractionForCapture } = await import('../db/extractions');
                          const json = await getLatestExtractionForCapture(db, item.id);
                          if (json) {
                            setExtractionChips((prev) => ({ ...prev, [item.id]: JSON.parse(json) as import('../types/extraction').ExtractionResult }));
                          }
                        } catch { /* non-critical */ }
                      })();
                    }
                  }}
                  activeOpacity={0.8}
                >
                  {/* Spine */}
                  <View style={styles.tlLeft}>
                    <View style={styles.tlSpineWrap}>
                      <View style={[styles.tlDot, { backgroundColor: moodColor, shadowColor: moodColor }]} />
                      {!isLast ? <View style={styles.tlLine} /> : null}
                    </View>
                  </View>

                  {/* Card */}
                  <View style={[styles.tlCard, isExpanded && styles.tlCardExpanded]}>
                    {/* Left accent bar — mood colour */}
                    <View style={[styles.tlAccent, { backgroundColor: moodColor }]} />

                    <View style={styles.tlCardContent}>

                      {/* ── Header row: source badge + content-type pill + privacy dot ── */}
                      {(() => {
                        const src = sourceLabel(item.source);
                        const extraction = extractionChips[item.id] ?? null;
                        // Use eagerly-loaded noteTypes first; fall back to expanded extraction
                        const rawNoteType = noteTypes[item.id] ?? extraction?.note_type;
                        const nt = noteTypeLabel(rawNoteType as import('../types/extraction').NoteType | undefined);
                        return (
                          <View style={styles.tlCardHeaderRow}>
                            <Text style={styles.tlTimeChip}>{timeStr}</Text>

                            {/* Source glyph + label */}
                            <Text style={[styles.tlSourceBadge, { color: src.color }]}>
                              {src.glyph} {src.label}
                            </Text>

                            {/* Content-type pill — only once extraction loaded; suppress when it duplicates the source badge */}
                            {nt && nt.label !== src.label ? (
                              <View style={[styles.tlTypePill, { borderColor: nt.color + '55' }]}>
                                <Text style={[styles.tlTypePillText, { color: nt.color }]}>{nt.label}</Text>
                              </View>
                            ) : null}

                            {/* Processing state — shown instead of type pill when pending; meetings skip extraction so always treated as done */}
                            {!nt && item.processed !== 1 && item.source !== 'meeting' ? (
                              <View style={styles.tlTypePill}>
                                {/* -1 now only means "transient hiccup, retrying quietly" — keep it calm, never "FAILED" */}
                                <OrganizingDots />
                              </View>
                            ) : null}

                            {/* Spacer */}
                            <View style={{ flex: 1 }} />

                            {/* Privacy Shield — shows when passwords/names were masked from the cloud */}
                            {(() => {
                              let count = 0;
                              try { count = item.protected_values ? (JSON.parse(item.protected_values) as unknown[]).length : 0; } catch { /* ignore */ }
                              return count > 0 ? (
                                <Text style={styles.tlShieldPillText}>🛡</Text>
                              ) : null;
                            })()}

                            {/* Privacy indicator — far right of header */}
                            <PrivacyBadge level={item.privacy_level} />

                            <TouchableOpacity
                              style={styles.tlMenuBtn}
                              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                              onPress={() => setMenuTarget(item)}
                            >
                              <Text style={styles.tlMenuBtnText}>⋯</Text>
                            </TouchableOpacity>
                          </View>
                        );
                      })()}

                      {/* ── Title ── */}
                      {item.extracted_title ? (
                        (() => {
                          let pv: ProtectedValueLite[] = [];
                          try { pv = item.protected_values ? JSON.parse(item.protected_values) as ProtectedValueLite[] : []; } catch { /* ignore */ }
                          return pv.length > 0 ? (
                            <ShieldedText style={styles.tlTitle} text={item.extracted_title} protectedValues={pv} numberOfLines={isExpanded ? undefined : 1} />
                          ) : (
                            <Text style={styles.tlTitle} numberOfLines={isExpanded ? undefined : 1}>
                              {protectedPreview(item.extracted_title)}
                            </Text>
                          );
                        })()
                      ) : item.source === 'meeting' ? (
                        // Meeting captures skip AI extraction — derive a title from the first line of raw_transcript.
                        <Text style={styles.tlTitle} numberOfLines={isExpanded ? undefined : 1}>
                          {(item.raw_transcript ?? '').split('\n')[0] || 'Meeting'}
                        </Text>
                      ) : item.processed === -1 ? (
                        <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 13, fontWeight: '500', lineHeight: 19 }}>
                          Saved · still organizing…
                        </Text>
                      ) : (
                        <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 13, fontWeight: '500', lineHeight: 19 }}>
                          Organizing your thought…
                        </Text>
                      )}

                      {/* ── Summary body ── */}
                      {(() => {
                        const extraction = extractionChips[item.id] ?? null;
                        const summaryText = getCardSummaryText(item, extraction);
                        if (!summaryText) return null;

                        // Collapsed: show a compact preview. Expanded: show full text.
                        // We always show the summary; chips only appear after expansion.
                        let pv: ProtectedValueLite[] = [];
                        try { pv = item.protected_values ? JSON.parse(item.protected_values) as ProtectedValueLite[] : []; } catch { /* ignore */ }
                        return (
                          <View style={{ marginTop: 5 }}>
                            {pv.length > 0 ? (
                              <ShieldedText style={styles.tlSummaryText} text={summaryText} protectedValues={pv} numberOfLines={isExpanded ? undefined : 2} />
                            ) : (
                              <Text
                                style={styles.tlSummaryText}
                                numberOfLines={isExpanded ? undefined : 2}
                              >
                                {summaryText}
                              </Text>
                            )}
                          </View>
                        );
                      })()}

                      {/* ── Processing error detail (expanded only) ── */}
                      {isExpanded && item.processed === -1 && item.processing_error ? (
                        <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 11, fontStyle: 'italic', marginTop: 4 }} numberOfLines={3}>
                          {item.processing_error}
                        </Text>
                      ) : null}

                      {/* ── Original photo (source of truth) — tap to view the real image ── */}
                      {isExpanded && item.source_image_path ? (
                        <TouchableOpacity style={styles.tlViewOriginal} onPress={() => setViewerImage(item.source_image_path)}>
                          <Ionicons name="image-outline" size={15} color={LUCY_COLORS.primary} />
                          <Text style={styles.tlViewOriginalText}>View original photo</Text>
                        </TouchableOpacity>
                      ) : null}

                      {/* ── Extraction chips — second layer, only when expanded ── */}
                      {isExpanded ? <ExtractionChips extraction={extractionChips[item.id] ?? null} /> : null}

                      {/* ── LLM-detected action banner ── */}
                      {llmActions[item.id] ? (
                        <TouchableOpacity
                          style={styles.tlActionBanner}
                          onPress={() => setPendingAction(llmActions[item.id])}
                        >
                          <Text style={styles.tlActionLabel}>CAN DO</Text>
                          <Text style={styles.tlActionText} numberOfLines={1}>{llmActions[item.id].displayText}</Text>
                          <Text style={styles.tlActionChevron}>›</Text>
                        </TouchableOpacity>
                      ) : null}

                    </View>
                  </View>
                </TouchableOpacity>
                </FadeInUp>
              );
            })}
          </View>
          );
        })}
        <View style={{ height: 20 }} />
      </ScrollView>

      {/* Card action menu (⋯) */}
      <Modal transparent animationType="fade" visible={menuTarget !== null} onRequestClose={() => setMenuTarget(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setMenuTarget(null)}>
          <Pressable style={styles.actionSheet}>
            <Text style={styles.actionSheetTitle} numberOfLines={1}>
              {menuTarget?.extracted_title ?? menuTarget?.raw_transcript?.slice(0, 48) ?? 'Memory'}
            </Text>
            {/* Ask LUCY about this — pre-fills Ask tab with the memory title */}
            {onAskAbout && menuTarget?.extracted_title ? (
              <TouchableOpacity
                style={styles.actionSheetItem}
                onPress={() => {
                  const t = menuTarget;
                  setMenuTarget(null);
                  onAskAbout(`Tell me more about: "${t?.extracted_title ?? ''}"`);
                }}
              >
                <Text style={[styles.actionSheetIcon, { color: '#60A5FA' }]}>✦</Text>
                <Text style={styles.actionSheetLabel}>Ask LUCY about this</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={styles.actionSheetItem}
              onPress={() => { const t = menuTarget; setMenuTarget(null); setFeedbackText(''); setFeedbackTarget(t); }}
            >
              <Text style={styles.actionSheetIcon}>?</Text>
              <Text style={styles.actionSheetLabel}>Correct this memory</Text>
            </TouchableOpacity>
            {menuTarget && menuTarget.source !== 'passive' ? (
              // Reprocess: available for all text captures; grayed out for failed passive clips
              <TouchableOpacity
                style={[styles.actionSheetItem, menuTarget.processed === 0 && { opacity: 0.4 }]}
                disabled={menuTarget.processed === 0}
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
                    const result = await executeAction(pendingAction);
                    setExecutingAction(false);
                    setPendingAction(null);
                    onQueued?.();
                    // Always show the result so the user knows what happened.
                    // A failed action (e.g. contact not found, permission denied)
                    // used to silently close the modal with no feedback.
                    if (!result.success) {
                      setConfirmSheet({ title: 'Couldn\'t complete that', message: result.message, actions: [{ label: 'Got it', style: 'primary' }], cancelLabel: null });
                    } else if (result.message) {
                      setTlToast(result.message);
                    }
                    // Remove the action banner once confirmed or dismissed
                    try {
                      const db = await getDatabase();
                      const captureId = Object.entries(llmActions).find(([,a]) => a === pendingAction)?.[0];
                      if (captureId) {
                        await db.runAsync('DELETE FROM pending_actions WHERE capture_id = ?', Number(captureId));
                        setLlmActions((prev) => { const next = { ...prev }; delete next[Number(captureId)]; return next; });
                      }
                    } catch { /* non-critical */ }
                  }}
                >
                  <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>{executingAction ? '...' : pendingAction.confirmText}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={{ paddingHorizontal: 16, justifyContent: 'center' }} onPress={async () => {
                  // Dismiss the action banner on "Not now" too
                  const captureId = Object.entries(llmActions).find(([,a]) => a === pendingAction)?.[0];
                  if (captureId) {
                    try { const db = await getDatabase(); await db.runAsync('DELETE FROM pending_actions WHERE capture_id = ?', Number(captureId)); } catch { /* non-critical */ }
                    setLlmActions((prev) => { const next = { ...prev }; delete next[Number(captureId)]; return next; });
                  }
                  setPendingAction(null);
                }}>
                  <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 14 }}>Not now</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
      <ActionSheet
        visible={!!confirmSheet}
        onClose={() => setConfirmSheet(null)}
        context={confirmSheet?.context}
        title={confirmSheet?.title ?? ''}
        message={confirmSheet?.message}
        accent={confirmSheet?.accent}
        actions={confirmSheet?.actions ?? []}
        cancelLabel={confirmSheet?.cancelLabel === undefined ? 'Cancel' : confirmSheet.cancelLabel}
      />
      <Toast visible={!!tlToast} message={tlToast ?? ''} onHide={() => setTlToast(null)} />
    </View>
  );
}

function LibraryView({
  tab,
  setTab,
  todos: initialTodos,
  ideas: initialIdeas,
  expenses: initialExpenses,
}: {
  tab: LibraryTab;
  setTab: (tab: LibraryTab) => void;
  todos: TodoRow[];
  ideas: IdeaRow[];
  expenses: ExpenseRow[];
}) {
  const [todos, setTodos] = useState(initialTodos);
  const [ideas, setIdeas] = useState(initialIdeas);
  const [expenses, setExpenses] = useState(initialExpenses);

  // Keep in sync when parent reloads (e.g. after refreshToken bump)
  useEffect(() => { setTodos(initialTodos); }, [initialTodos]);
  useEffect(() => { setIdeas(initialIdeas); }, [initialIdeas]);
  useEffect(() => { setExpenses(initialExpenses); }, [initialExpenses]);

  const deleteTodo = async (id: number) => {
    const db = await getDatabase();
    const { deleteTodo: del } = await import('../db/todos');
    await del(db, id);
    setTodos((prev) => prev.filter((t) => t.id !== id));
  };

  const deleteIdea = async (id: number) => {
    const db = await getDatabase();
    const { deleteIdea: del } = await import('../db/ideas');
    await del(db, id);
    setIdeas((prev) => prev.filter((i) => i.id !== id));
  };

  const deleteExpense = async (id: number) => {
    const db = await getDatabase();
    const { deleteExpense: del } = await import('../db/expenses');
    await del(db, id);
    setExpenses((prev) => prev.filter((e) => e.id !== id));
  };

  // Workspace HOME = Lumia live-tile command center (no tab-heavy layout).
  if (tab === 'Home') {
    return (
      <View style={styles.library}>
        <WorkspaceHome onOpen={(t) => setTab(t as LibraryTab)} onPlanDay={() => setTab('Calendar')} />
      </View>
    );
  }

  // A section view: a single "← Workspace" back bar, then the section (no horizontal tab strip).
  const backBar = (
    <TouchableOpacity style={styles.wsBack} onPress={() => setTab('Home')}>
      <Text style={styles.wsBackText}>‹ Workspace</Text>
      <Text style={styles.wsBackTitle}>{TAB_LABEL[tab] ?? tab}</Text>
    </TouchableOpacity>
  );

  // Galaxy + Documents + Calendar + Projects + Goals are full-screen browsers (own scroll; no outer ScrollView).
  if (tab === 'Galaxy' || tab === 'Documents' || tab === 'Calendar' || tab === 'Projects' || tab === 'Goals') {
    return (
      <View style={styles.library}>
        {backBar}
        <View style={{ flex: 1 }}>
          {tab === 'Galaxy' ? <GalaxyView /> : tab === 'Documents' ? <DocumentsTab /> : tab === 'Calendar' ? <ScheduleTab /> : tab === 'Goals' ? <MoneyGoals /> : <ProjectsTab />}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.library}>
      {backBar}
      <ScrollView style={styles.content}>
        {tab === 'Todos' && todos.map((item) => <Card key={item.id} title={item.task} detail={`${item.category} / ${item.urgency} / ${item.status}`} privacy={item.privacy_level} onDelete={() => void deleteTodo(item.id)} />)}
        {tab === 'Ideas' && ideas.map((item) => <Card key={item.id} title={item.title} detail={item.description} privacy={item.privacy_level} onDelete={() => void deleteIdea(item.id)} />)}
        {tab === 'Expenses' && expenses.map((item) => <Card key={item.id} title={`${item.amount ?? '-'} - ${item.description}`} detail={item.category} privacy={item.privacy_level} onDelete={() => void deleteExpense(item.id)} />)}
        {tab === 'People' && <PeopleTab />}
        {tab === 'Resources' && <ResourcesTab />}
        {tab === 'Meetings' && <MeetingsTab />}
        {tab === 'Listen' && <ListenTab />}
        {tab === 'Reminders' && <RemindersTab />}
        {tab === 'Gallery' && <GalleryTab />}
        {tab === 'Medications' && <MedicationsTab />}
      </ScrollView>
    </View>
  );
}

function MedicationsTab() {
  type Med = import('../db/medications').MedicationRow;
  const [meds, setMeds] = useState<Med[]>([]);
  const [taken, setTaken] = useState<Record<number, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState(''); const [dosage, setDosage] = useState(''); const [times, setTimes] = useState('');
  const dateKey = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD local

  const load = async () => {
    try {
      const db = await getDatabase();
      const { listMedications, takenTimesToday } = await import('../db/medications');
      const list = await listMedications(db);
      setMeds(list);
      const t: Record<number, string[]> = {};
      for (const m of list) t[m.id] = await takenTimesToday(db, m.id, dateKey);
      setTaken(t);
    } catch { /* ignore */ } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const add = async () => {
    if (!name.trim()) return;
    const parsed = times.split(/[,\s]+/).map((s) => s.trim()).filter((s) => /^\d{1,2}:\d{2}$/.test(s));
    const db = await getDatabase();
    const { addMedication, listMedications } = await import('../db/medications');
    const id = await addMedication(db, name, dosage, parsed, null);
    const { scheduleMedReminders } = await import('../processing/medicationReminders');
    const fresh = (await listMedications(db)).find((m) => m.id === id);
    if (fresh) await scheduleMedReminders(fresh);
    setName(''); setDosage(''); setTimes(''); setAdding(false);
    await load();
  };
  const markTaken = async (m: Med, t: string) => {
    setTaken((prev) => ({ ...prev, [m.id]: [...(prev[m.id] ?? []), t] }));
    const db = await getDatabase();
    const { logMedicationTaken } = await import('../db/medications');
    await logMedicationTaken(db, m.id, dateKey, t);
  };
  const remove = (m: Med) => {
    Alert.alert('Stop tracking?', `"${m.name}" and its reminders will be removed.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        const db = await getDatabase();
        const { deactivateMedication } = await import('../db/medications');
        const { cancelMedReminders } = await import('../processing/medicationReminders');
        await cancelMedReminders(m); await deactivateMedication(db, m.id); await load();
      } },
    ]);
  };

  if (loading) return <View style={{ paddingVertical: 30 }}><ActivityIndicator color={LUCY_COLORS.primary} /></View>;
  const parse = (s: string | null) => { try { return s ? (JSON.parse(s) as string[]) : []; } catch { return []; } };
  return (
    <>
      <TouchableOpacity style={styles.medAddBtn} onPress={() => setAdding((v) => !v)}>
        <Text style={styles.medAddBtnText}>{adding ? 'Close' : '＋ Add medication'}</Text>
      </TouchableOpacity>
      {adding && (
        <View style={styles.medForm}>
          <TextInput style={styles.medInput} placeholder="Name (e.g. Metformin)" placeholderTextColor={LUCY_COLORS.textSubtle} value={name} onChangeText={setName} />
          <TextInput style={styles.medInput} placeholder="Dosage (e.g. 500mg)" placeholderTextColor={LUCY_COLORS.textSubtle} value={dosage} onChangeText={setDosage} />
          <TextInput style={styles.medInput} placeholder="Times — 08:00, 21:00" placeholderTextColor={LUCY_COLORS.textSubtle} value={times} onChangeText={setTimes} />
          <TouchableOpacity style={[styles.medAddBtn, !name.trim() && { opacity: 0.4 }]} disabled={!name.trim()} onPress={() => void add()}>
            <Text style={styles.medAddBtnText}>Save & set reminders</Text>
          </TouchableOpacity>
          <Text style={styles.medNote}>LUCY only reminds you to take what you enter — it never advises on drugs or doses. Check with your doctor.</Text>
        </View>
      )}
      {!meds.length ? <EmptyLine text="No medications tracked. Add one and LUCY will remind you at each dose time." /> : null}
      {meds.map((m) => {
        const ts = parse(m.times); const done = taken[m.id] ?? [];
        return (
          <View key={m.id} style={styles.medCard}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <Text style={styles.medName}>{m.name}{m.dosage ? <Text style={styles.medDose}>  ·  {m.dosage}</Text> : null}</Text>
              <TouchableOpacity onPress={() => remove(m)}><Text style={styles.medRemove}>Remove</Text></TouchableOpacity>
            </View>
            {ts.length ? (
              <View style={styles.medTimes}>
                {ts.map((t) => {
                  const isDone = done.includes(t);
                  return (
                    <TouchableOpacity key={t} disabled={isDone} style={[styles.medTimeChip, isDone && styles.medTimeChipDone]} onPress={() => void markTaken(m, t)}>
                      <Text style={[styles.medTimeText, isDone && styles.medTimeTextDone]}>{isDone ? `✓ ${t}` : t}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : <Text style={styles.medNote}>No times set — add some to get reminders.</Text>}
          </View>
        );
      })}
    </>
  );
}

function GalleryTab() {
  const [rows, setRows] = useState<Array<{ id: number; source_image_path: string; extracted_title: string | null; created_at: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [viewer, setViewer] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const db = await getDatabase();
        const list = await db.getAllAsync<{ id: number; source_image_path: string; extracted_title: string | null; created_at: string }>(
          "SELECT id, source_image_path, extracted_title, created_at FROM captures WHERE source_image_path IS NOT NULL AND source_image_path != '' ORDER BY created_at DESC LIMIT 200",
        );
        setRows(list);
      } catch { /* ignore */ } finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <View style={{ paddingVertical: 30 }}><ActivityIndicator color={LUCY_COLORS.primary} /></View>;
  if (!rows.length) return (
    <LucyEmptyState
      title="No photos yet"
      message="Snap a note, receipt, or whiteboard — I'll read it and keep the original right here."
    />
  );
  return (
    <>
      <View style={styles.galleryGrid}>
        {rows.map((r) => (
          <TouchableOpacity key={r.id} style={styles.galleryCell} activeOpacity={0.85} onPress={() => setViewer(r.source_image_path)}>
            <Image source={{ uri: r.source_image_path }} style={styles.galleryThumb} resizeMode="cover" />
          </TouchableOpacity>
        ))}
      </View>
      <Modal visible={!!viewer} transparent animationType="fade" onRequestClose={() => setViewer(null)}>
        <Pressable style={styles.imageViewerBackdrop} onPress={() => setViewer(null)}>
          {viewer ? <Image source={{ uri: viewer }} style={styles.imageViewerImg} resizeMode="contain" /> : null}
          <Text style={styles.imageViewerHint}>Tap to close · original photo</Text>
        </Pressable>
      </Modal>
    </>
  );
}

function RemindersTab() {
  const [rows, setRows] = useState<Array<{ id: number; text: string; remind_at: string | null; urgency: string | null; recurrence: string | null }>>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const db = await getDatabase();
      const { listReminders } = await import('../db/reminders');
      const list = await listReminders(db);
      setRows(list.map((r) => ({ id: r.id, text: r.text, remind_at: r.remind_at ?? null, urgency: (r as { urgency?: string | null }).urgency ?? null, recurrence: (r as { recurrence?: string | null }).recurrence ?? null })));
    } catch { /* ignore */ } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const dismiss = async (id: number) => {
    setRows((r) => r.filter((x) => x.id !== id));
    try {
      const db = await getDatabase();
      const { archiveReminder } = await import('../db/reminders');
      await archiveReminder(db, id, 'dismissed from workspace');
    } catch { /* ignore */ }
  };

  const whenLabel = (iso: string | null) => {
    if (!iso) return 'No time set';
    const d = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`);
    if (Number.isNaN(d.getTime())) return 'No time set';
    return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };

  if (loading) return <View style={{ paddingVertical: 30 }}><ActivityIndicator color={LUCY_COLORS.primary} /></View>;
  if (!rows.length) return (
    <LucyEmptyState
      title="No reminders yet"
      message={'Say or type "remind me to…" and I\'ll nudge you at the right moment.'}
    />
  );
  return (
    <>
      {rows.map((r) => (
        <View key={r.id} style={styles.reminderRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.reminderText}>{protectedPreview(r.text)}</Text>
            <Text style={styles.reminderMeta}>
              {whenLabel(r.remind_at)}{r.recurrence ? ` · repeats ${r.recurrence}` : ''}{r.urgency ? ` · ${r.urgency}` : ''}
            </Text>
          </View>
          <TouchableOpacity onPress={() => void dismiss(r.id)} style={styles.reminderDone}>
            <Text style={styles.reminderDoneText}>Done</Text>
          </TouchableOpacity>
        </View>
      ))}
    </>
  );
}

function ListenTab() {
  const [sessions, setSessions] = useState<ListenSessionGroup[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [clipTexts, setClipTexts] = useState<Record<string, string[]>>({});
  const [digestCount, setDigestCount] = useState(0);
  const [generatingDigest, setGeneratingDigest] = useState(false);

  useEffect(() => {
    void (async () => {
      const db = await getDatabase();
      const [s, count] = await Promise.all([
        listListenSessions(db),
        import('../processing/listenDigest').then(({ hasUnsummarizedListenCaptures }) => hasUnsummarizedListenCaptures(db)).catch(() => 0),
      ]);
      setSessions(s);
      setDigestCount(count as number);
    })();
  }, []);

  const generateDigest = async () => {
    setGeneratingDigest(true);
    try {
      const db = await getDatabase();
      const { generateListenDigest } = await import('../processing/listenDigest');
      const result = await generateListenDigest(db);
      if (result) {
        // Refresh sessions to show the new digest entry
        setSessions(await listListenSessions(db));
        setDigestCount(0);
      } else {
        Alert.alert('Not enough captures', 'Need at least 5 listen clips today to generate a digest.');
      }
    } catch { /* non-critical */ } finally {
      setGeneratingDigest(false);
    }
  };

  const toggleExpand = async (s: ListenSessionGroup) => {
    const wasExpanded = expanded[s.sessionId];
    setExpanded((prev) => ({ ...prev, [s.sessionId]: !wasExpanded }));
    // Load full transcripts the first time a session is expanded
    if (!wasExpanded && !clipTexts[s.sessionId] && s.captureIds.length > 0) {
      try {
        const db = await getDatabase();
        const placeholders = s.captureIds.map(() => '?').join(',');
        const rows = await db.getAllAsync<{ id: number; raw_transcript: string; extracted_title: string | null }>(
          `SELECT id, raw_transcript, extracted_title FROM captures WHERE id IN (${placeholders}) ORDER BY created_at ASC, id ASC`,
          ...s.captureIds,
        );
        setClipTexts((prev) => ({
          ...prev,
          [s.sessionId]: rows.map((r) => r.extracted_title ?? (r.raw_transcript ?? '').slice(0, 300)),
        }));
      } catch { /* non-critical */ }
    }
  };

  const deleteSession = async (sessionId: string, captureIds: number[]) => {
    Alert.alert('Delete listen session?', 'All clips from this session will be permanently removed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          const db = await getDatabase();
          const { deleteCaptureCompletely } = await import('../db/captures');
          await Promise.all(captureIds.map((id) => deleteCaptureCompletely(db, id)));
          setSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
        },
      },
    ]);
  };

  const formatDate = (iso: string) => new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`)
    .toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  const durationLabel = (start: string, end: string) => {
    const ms = new Date(end.includes('T') ? end : `${end.replace(' ', 'T')}Z`).getTime()
             - new Date(start.includes('T') ? start : `${start.replace(' ', 'T')}Z`).getTime();
    const min = Math.max(1, Math.round(ms / 60000));
    return `${min} min`;
  };

  if (sessions.length === 0) {
    return (
      <View style={{ padding: 20, gap: 8 }}>
        <Text style={styles.empty}>No listen sessions yet.</Text>
        <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 13, lineHeight: 19 }}>
          Tap the Listen button in the header to start. LUCY captures ambient audio in batches — stop early and it processes immediately.
        </Text>
        <Text style={{ color: '#F59E0B', fontSize: 12, marginTop: 4 }}>
          ⚠ Transcription requires an OpenAI API key (Settings → Remote intelligence).
        </Text>
      </View>
    );
  }

  return (
    <>
      {/* Day digest button — shown when there are unsummarized clips from today */}
      {digestCount >= 5 ? (
        <TouchableOpacity
          style={{ backgroundColor: LUCY_COLORS.primarySoft, borderRadius: 14, padding: 14, marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: LUCY_COLORS.primary + '44' }}
          onPress={() => void generateDigest()}
          disabled={generatingDigest}
          activeOpacity={0.8}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: LUCY_COLORS.primaryGlow, fontWeight: '800', fontSize: 14 }}>
              {generatingDigest ? 'Generating digest…' : '✦ Generate Day Listen Digest'}
            </Text>
            <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 12 }}>
              Stitch {digestCount} clips from today into one insight summary
            </Text>
          </View>
          {!generatingDigest ? <Text style={{ color: LUCY_COLORS.primary, fontSize: 18 }}>›</Text> : null}
        </TouchableOpacity>
      ) : null}

      {sessions.map((s) => (
        <View key={s.sessionId} style={[styles.card, { borderLeftWidth: 3, borderLeftColor: s.sessionId.startsWith('digest_') ? LUCY_COLORS.primary : '#5B8CFF' }]}>
          <View style={styles.cardTop}>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={{ color: s.sessionId.startsWith('digest_') ? LUCY_COLORS.primaryGlow : '#5B8CFF', fontSize: 10, fontWeight: '800', letterSpacing: 1 }}>
                {s.sessionId.startsWith('digest_') ? '✦ LISTEN DIGEST' : '🎙 LISTEN SESSION'}
              </Text>
              <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 11 }}>
                {formatDate(s.startedAt)} · {durationLabel(s.startedAt, s.endedAt)} · {s.captureCount} clip{s.captureCount !== 1 ? 's' : ''}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <TouchableOpacity onPress={() => void toggleExpand(s)}>
                <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 13, fontWeight: '700' }}>{expanded[s.sessionId] ? '▾' : '▸'}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => void deleteSession(s.sessionId, s.captureIds)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={{ color: '#ef4444', fontSize: 16, fontWeight: '700' }}>✕</Text>
              </TouchableOpacity>
            </View>
          </View>
          {/* Collapsed preview snippets */}
          {!expanded[s.sessionId] ? s.snippets.map((snip, i) => (
            <Text key={i} style={[styles.detail, { marginTop: i === 0 ? 6 : 2 }]} numberOfLines={2}>"{snip}"</Text>
          )) : null}
          {/* Expanded: full transcript text per clip */}
          {expanded[s.sessionId] ? (
            <View style={{ marginTop: 10, gap: 10 }}>
              {(clipTexts[s.sessionId] ?? s.snippets).map((text, i) => (
                <View key={i} style={{ backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 10, padding: 10, gap: 4 }}>
                  <Text style={{ color: '#5B8CFF', fontSize: 9, fontWeight: '800', letterSpacing: 1 }}>CLIP {i + 1}</Text>
                  <Text style={{ color: LUCY_COLORS.textMuted, fontSize: 13, lineHeight: 19 }}>{text || '(no transcript)'}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ))}
    </>
  );
}

function ResourcesTab() {
  const [resources, setResources] = useState<import('../processing/onlineResource').OnlineResourceRow[]>([]);

  useEffect(() => {
    void (async () => {
      const db = await getDatabase();
      const { listOnlineResources } = await import('../processing/onlineResource');
      setResources(await listOnlineResources(db));
    })();
  }, []);

  const remove = async (id: number) => {
    const db = await getDatabase();
    const { deleteOnlineResource } = await import('../processing/onlineResource');
    await deleteOnlineResource(db, id);
    setResources((prev) => prev.filter((r) => r.id !== id));
  };

  if (resources.length === 0) {
    return (
      <View style={{ padding: 20, gap: 8 }}>
        <Text style={styles.empty}>No saved resources yet.</Text>
        <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 13, lineHeight: 19 }}>
          Share a YouTube short, Instagram reel, TikTok, or article link to LUCY — it saves here, organized by topic.
        </Text>
      </View>
    );
  }

  // Group by topic
  const byTopic = new Map<string, typeof resources>();
  for (const r of resources) {
    const arr = byTopic.get(r.topic) ?? [];
    arr.push(r);
    byTopic.set(r.topic, arr);
  }

  const platformIcon: Record<string, keyof typeof Ionicons.glyphMap> = {
    youtube: 'logo-youtube', instagram: 'logo-instagram', tiktok: 'logo-tiktok', twitter: 'logo-twitter', vimeo: 'videocam', web: 'link',
  };

  return (
    <>
      {[...byTopic.entries()].map(([topic, items]) => (
        <View key={topic}>
          <SectionTitle title={topic} count={items.length} />
          {items.map((r) => (
            <TouchableOpacity key={r.id} style={[styles.card, { flexDirection: 'row', alignItems: 'center', gap: 12 }]} onPress={() => void Linking.openURL(r.url).catch(() => {})}>
              <Ionicons name={platformIcon[r.platform] ?? 'link'} size={22} color={LUCY_COLORS.primaryGlow} />
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle} numberOfLines={2}>{r.title}</Text>
                <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 11, marginTop: 2, textTransform: 'capitalize' }}>{r.platform}</Text>
              </View>
              <TouchableOpacity onPress={() => void remove(r.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={{ color: '#ef4444', fontSize: 16, fontWeight: '700' }}>✕</Text>
              </TouchableOpacity>
            </TouchableOpacity>
          ))}
        </View>
      ))}
    </>
  );
}

function MeetingsTab() {
  const [meetings, setMeetings] = useState<import('../db/meetingSummaries').MeetingSummaryRow[]>([]);
  const [selected, setSelected] = useState<import('../db/meetingSummaries').MeetingSummaryRow | null>(null);
  const meetingCardRef = useRef<View>(null);

  useEffect(() => {
    void (async () => {
      const db = await getDatabase();
      const { listMeetingSummaries } = await import('../db/meetingSummaries');
      setMeetings(await listMeetingSummaries(db));
    })();
  }, []);

  const deleteMeeting = async (id: number) => {
    const db = await getDatabase();
    const { deleteMeetingSummary } = await import('../db/meetingSummaries');
    await deleteMeetingSummary(db, id);
    setMeetings((prev) => prev.filter((m) => m.id !== id));
  };

  if (meetings.length === 0) {
    return <Text style={styles.empty}>No meetings saved yet. Use Meeting Mode in the header to record and summarise a meeting.</Text>;
  }

  const formatDate = (iso: string) => new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  return (
    <>
      {meetings.map((m) => (
        <TouchableOpacity key={m.id} onPress={() => setSelected(m)} style={styles.card}>
          <View style={styles.cardTop}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.cardTitle}>⌘ {m.title}</Text>
              <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 11 }}>
                {formatDate(m.recorded_at)} · {m.duration_minutes} min
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => Alert.alert('Delete meeting?', 'Removes this summary permanently.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => void deleteMeeting(m.id) }])}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={{ color: '#ef4444', fontSize: 16, fontWeight: '700' }}>✕</Text>
            </TouchableOpacity>
          </View>
          {m.headline ? <Text style={styles.detail} numberOfLines={2}>{m.headline}</Text> : null}
          {(() => {
            const actions = m.action_items ? (JSON.parse(m.action_items) as Array<{task:string}>) : [];
            return actions.length > 0
              ? <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 11, marginTop: 4 }}>{actions.length} action item{actions.length !== 1 ? 's' : ''}</Text>
              : null;
          })()}
        </TouchableOpacity>
      ))}

      {/* Meeting detail modal */}
      <Modal transparent animationType="slide" visible={selected !== null} onRequestClose={() => setSelected(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setSelected(null)}>
          <Pressable style={[styles.feedbackModal, { maxHeight: '90%', gap: 0 }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', marginBottom: 4 }}>
              <TouchableOpacity onPress={() => setSelected(null)} style={{ paddingLeft: 12 }}>
                <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 14, fontWeight: '700' }}>Done</Text>
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View ref={meetingCardRef} collapsable={false} style={{ backgroundColor: LUCY_COLORS.surface, borderRadius: 14, padding: 14 }}>
              <Text style={{ fontSize: 18, fontWeight: '800', color: LUCY_COLORS.textDark }} numberOfLines={2}>{selected?.title}</Text>
              <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 12, marginBottom: 12, marginTop: 2 }}>
                {selected ? formatDate(selected.recorded_at) : ''} · {selected?.duration_minutes} min
              </Text>
              {selected?.headline ? <Text style={{ color: LUCY_COLORS.textDark, fontSize: 15, fontWeight: '600', lineHeight: 22, marginBottom: 14 }}>{selected.headline}</Text> : null}
              {(() => {
                if (!selected) return null;
                const decisions: string[] = selected.key_decisions ? JSON.parse(selected.key_decisions) : [];
                const actions: Array<{task:string;owner?:string;deadline?:string}> = selected.action_items ? JSON.parse(selected.action_items) : [];
                const questions: string[] = selected.open_questions ? JSON.parse(selected.open_questions) : [];
                const attendees: string[] = selected.attendees ? JSON.parse(selected.attendees) : [];
                return (
                  <>
                    {decisions.length > 0 && (<>
                      <Text style={{ color: LUCY_COLORS.primary, fontSize: 11, fontWeight: '800', letterSpacing: 1, marginBottom: 6 }}>DECISIONS</Text>
                      {decisions.map((d, i) => <Text key={i} style={{ color: LUCY_COLORS.textMuted, fontSize: 13, marginBottom: 4 }}>• {d}</Text>)}
                    </>)}
                    {actions.length > 0 && (<>
                      <Text style={{ color: LUCY_COLORS.primary, fontSize: 11, fontWeight: '800', letterSpacing: 1, marginTop: 12, marginBottom: 6 }}>ACTION ITEMS</Text>
                      {actions.map((a, i) => <Text key={i} style={{ color: LUCY_COLORS.textMuted, fontSize: 13, marginBottom: 5 }}>
                        → {a.task}{a.owner ? ` (${a.owner})` : ''}{a.deadline ? ` · ${a.deadline}` : ''}
                      </Text>)}
                    </>)}
                    {questions.length > 0 && (<>
                      <Text style={{ color: LUCY_COLORS.primary, fontSize: 11, fontWeight: '800', letterSpacing: 1, marginTop: 12, marginBottom: 6 }}>OPEN QUESTIONS</Text>
                      {questions.map((q, i) => <Text key={i} style={{ color: LUCY_COLORS.textMuted, fontSize: 13, marginBottom: 4 }}>? {q}</Text>)}
                    </>)}
                    {selected.next_steps ? (<>
                      <Text style={{ color: LUCY_COLORS.primary, fontSize: 11, fontWeight: '800', letterSpacing: 1, marginTop: 12, marginBottom: 6 }}>NEXT STEPS</Text>
                      <Text style={{ color: LUCY_COLORS.textMuted, fontSize: 13, lineHeight: 20 }}>{selected.next_steps}</Text>
                    </>) : null}
                    {attendees.length > 0 && <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 12, marginTop: 14 }}>Mentioned: {attendees.join(', ')}</Text>}
                  </>
                );
              })()}
                <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 11, fontWeight: '800', letterSpacing: 0.5, marginTop: 18, textAlign: 'right' }}>LUC<Text style={{ color: LUCY_COLORS.primary }}>Y</Text> · meeting summary</Text>
              </View>
            </ScrollView>
            {selected ? <MeetingShareBar cardRef={meetingCardRef} getText={() => formatMeetingRowText(selected)} /> : null}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function PeopleTab() {
  const [people, setPeople] = useState<Array<{ name: string; lastMentioned: string | null; mentionCount: number; typicalContext: string | null; pendingFollowUps: number }>>([]);
  const [storySubject, setStorySubject] = useState<StorySubject | null>(null);

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
        const daysSince = p.lastMentioned
          ? Math.floor((Date.now() - new Date(p.lastMentioned.includes('T') ? p.lastMentioned : `${p.lastMentioned.replace(' ', 'T')}Z`).getTime()) / 86400000)
          : null;
        const detail = [
          `${p.mentionCount} mention${p.mentionCount !== 1 ? 's' : ''}`,
          daysSince !== null ? (daysSince === 0 ? 'today' : `${daysSince}d ago`) : null,
          p.pendingFollowUps > 0 ? `${p.pendingFollowUps} follow-up${p.pendingFollowUps !== 1 ? 's' : ''} pending` : null,
        ].filter(Boolean).join(' · ');
        return (
          <TouchableOpacity key={p.name} onPress={() => setStorySubject({ kind: 'person', name: p.name, mentionCount: p.mentionCount, lastMentioned: p.lastMentioned, pendingFollowUps: p.pendingFollowUps, typicalContext: p.typicalContext })} activeOpacity={0.75}>
            <Card
              title={p.name}
              detail={detail}
              privacy={undefined}
            />
          </TouchableOpacity>
        );
      })}

      <StoryView subject={storySubject} visible={storySubject !== null} onClose={() => setStorySubject(null)} />
    </>
  );
}

const URGENCY_CONFIG = {
  high: { label: 'HIGH', color: '#EF4444', bg: 'rgba(239,68,68,0.12)' },
  medium: { label: 'MED', color: '#F59E0B', bg: 'rgba(245,158,11,0.12)' },
  low: { label: 'LOW', color: '#6EE7B7', bg: 'rgba(110,231,183,0.10)' },
};

function FocusTodoCard({ item }: { item: TodoRow }) {
  const urg = URGENCY_CONFIG[item.urgency as 'high' | 'medium' | 'low'] ?? URGENCY_CONFIG.low;
  return (
    <View style={[styles.card, { borderLeftWidth: 3, borderLeftColor: urg.color, paddingLeft: 13 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle} numberOfLines={2}>{protectedPreview(item.task)}</Text>
          {item.category ? (
            <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 12, marginTop: 3, textTransform: 'capitalize' }}>{item.category}</Text>
          ) : null}
        </View>
        <View style={{ alignItems: 'flex-end', gap: 6 }}>
          <View style={{ backgroundColor: urg.bg, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 }}>
            <Text style={{ color: urg.color, fontSize: 10, fontWeight: '800', letterSpacing: 0.6 }}>{urg.label}</Text>
          </View>
          {item.privacy_level ? <PrivacyBadge level={item.privacy_level} /> : null}
        </View>
      </View>
    </View>
  );
}

function SectionTitle({ title, count }: { title: string; count?: number }) {
  return (
    <View style={styles.sectionTitleRow}>
      <View style={styles.sectionTitleAccent} />
      <Text style={styles.sectionTitle}>{title}</Text>
      {count != null ? (
        <View style={styles.sectionTitleBadge}>
          <Text style={styles.sectionTitleBadgeText}>{count}</Text>
        </View>
      ) : null}
    </View>
  );
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

function Card({ title, detail, privacy, onDelete }: { title: string; detail: string; privacy?: 'private' | 'local' | 'normal'; onDelete?: () => void }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <Text style={[styles.cardTitle, { flex: 1 }]}>{protectedPreview(title)}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {privacy ? <PrivacyBadge level={privacy} /> : null}
          {onDelete ? (
            <TouchableOpacity
              onPress={() => Alert.alert('Delete permanently?', 'This removes the item from your brain everywhere. This cannot be undone.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: onDelete },
              ])}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={{ color: '#ef4444', fontSize: 16, fontWeight: '700' }}>✕</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
      <Text style={styles.detail}>{protectedPreview(detail)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  homeHero: { position: 'relative', overflow: 'hidden', backgroundColor: LUCY_COLORS.surface, borderWidth: 1, borderColor: LUCY_COLORS.borderSoft, borderRadius: 18, paddingLeft: 14, paddingRight: 70, paddingTop: 10, paddingBottom: 10, marginTop: 6, marginBottom: 8 },
  homeHeroGlow: { position: 'absolute', right: -72, top: -92, width: 156, height: 156, borderRadius: 78, backgroundColor: 'rgba(255,140,66,0.10)' },
  todayDate: { color: LUCY_COLORS.primaryGlow, fontSize: 10, fontWeight: '800', letterSpacing: 0.8, marginBottom: 2, textTransform: 'uppercase' },
  title: { fontSize: 22, letterSpacing: -0.2, fontWeight: '900', color: LUCY_COLORS.textDark, lineHeight: 25 },
  subtitle: { color: LUCY_COLORS.textMuted, fontSize: 12.5, marginTop: 3, lineHeight: 17, maxWidth: 280 },
  viewNav: { marginBottom: 8 },
  // "Today" glance strip
  content: { flex: 1 },
  tonight: { backgroundColor: LUCY_COLORS.surface, borderColor: LUCY_COLORS.primarySoft, borderWidth: 1, borderRadius: 24, padding: 19, marginBottom: 16 },
  eyebrow: { color: LUCY_COLORS.primaryGlow, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  tonightTitle: { color: LUCY_COLORS.textDark, fontSize: 21, fontWeight: '700', marginTop: 9 },
  tonightDetail: { color: LUCY_COLORS.textMuted, fontSize: 14, marginTop: 7 },
  // Timeline
  tlDateHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 13, marginBottom: 8 },
  tlDateLabel: { color: LUCY_COLORS.primary, fontSize: 10.5, fontWeight: '800', letterSpacing: 1.4, textTransform: 'uppercase', flexShrink: 0 },
  tlDateLine: { flex: 1, height: 1, backgroundColor: LUCY_COLORS.divider },
  tlRow: { flexDirection: 'row', gap: 0, marginBottom: 5, alignItems: 'stretch' },
  tlLeft: { width: 18, alignItems: 'center', paddingTop: 14 },
  tlSpineWrap: { alignItems: 'center', flex: 1 },
  tlDot: { width: 7, height: 7, borderRadius: 4, shadowOpacity: 0.45, shadowRadius: 3, elevation: 2 },
  tlLine: { width: 1, backgroundColor: LUCY_COLORS.divider, flex: 1, minHeight: 36 },
  tlCard: { flex: 1, backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 14, borderWidth: 1, borderColor: LUCY_COLORS.border, borderTopColor: LUCY_COLORS.primaryLine, marginBottom: 0, flexDirection: 'row', overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.16, shadowRadius: 5, elevation: 2 },
  tlCardExpanded: { borderColor: 'rgba(255,140,66,0.32)' },
  tlAccent: { width: 2, borderRadius: 0 },
  tlCardContent: { flex: 1, paddingTop: 8, paddingBottom: 9, paddingHorizontal: 10, gap: 0 },

  // Header row: source badge + type pill + privacy dot
  tlCardHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 },
  tlTimeChip: { color: LUCY_COLORS.textSubtle, fontSize: 10.5, fontWeight: '800', minWidth: 45 },
  tlSourceBadge: { fontSize: 9.5, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase' },
  tlTypePill: {
    borderRadius: 5,
    borderWidth: 1,
    borderColor: 'rgba(255,140,66,0.28)',
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  tlTypePillText: { fontSize: 9.5, fontWeight: '800', letterSpacing: 1.05 },
  tlShieldPillText: { fontSize: 12, marginRight: 3 },

  // Card body
  tlTitle: { color: LUCY_COLORS.textDark, fontSize: 13.5, fontWeight: '700', lineHeight: 18, marginBottom: 0 },

  // Summary text — the main readable body
  tlSummaryText: {
    color: LUCY_COLORS.textMuted,
    fontSize: 12.5,
    lineHeight: 17,
    fontWeight: '400',
  },
  tlSnippet: { color: LUCY_COLORS.textMuted, fontSize: 12, lineHeight: 18 },
  tlKeyPoints: { marginTop: 8, gap: 3 },
  tlKeyPoint: { color: LUCY_COLORS.textDark, fontSize: 12, lineHeight: 18 },
  tlActionBanner: { marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: LUCY_COLORS.primarySoft, borderRadius: 9, paddingVertical: 6, paddingHorizontal: 8 },
  tlActionLabel: { color: LUCY_COLORS.primary, fontSize: 9, fontWeight: '900', letterSpacing: 0.7 },
  tlActionText: { color: LUCY_COLORS.textDark, fontSize: 11.5, fontWeight: '700', flex: 1 },
  tlActionChevron: { color: LUCY_COLORS.primary, fontSize: 12, fontWeight: '900' },
  otdCard: { backgroundColor: LUCY_COLORS.surface, borderWidth: 1, borderColor: 'rgba(255,140,66,0.2)', borderRadius: 20, padding: 16, marginBottom: 14 },
  otdLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.5, color: LUCY_COLORS.primaryGlow, textTransform: 'uppercase', marginBottom: 6 },
  otdTitle: { fontSize: 15, fontWeight: '700', color: LUCY_COLORS.textDark, lineHeight: 22, marginBottom: 4 },
  otdSnippet: { fontSize: 13, color: LUCY_COLORS.textMuted, lineHeight: 19, fontStyle: 'italic' },
  otdMore: { fontSize: 11, color: LUCY_COLORS.textSubtle, marginTop: 6 },
  moodBar: { marginTop: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,140,66,0.12)' },
  moodLabel: { fontSize: 12, fontWeight: '700' },
  moodDots: { flexDirection: 'row', gap: 4 },
  moodDot: { width: 10, height: 10, borderRadius: 5 },
  contextPrompt: { backgroundColor: LUCY_COLORS.surfaceRaised, borderColor: LUCY_COLORS.primarySoft, borderWidth: 1, borderRadius: 20, padding: 16, marginBottom: 19 },
  contextPromptTitle: { color: LUCY_COLORS.textDark, fontSize: 17, fontWeight: '700', marginTop: 8 },
  contextIntro: { backgroundColor: LUCY_COLORS.surfaceRaised, borderColor: LUCY_COLORS.primarySoft, borderWidth: 1, borderRadius: 22, padding: 22, marginBottom: 14 },  // was 18
  contextCard: { backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 18, borderWidth: 1, borderColor: LUCY_COLORS.border, padding: 18, marginBottom: 12, gap: 9 },  // was 15
  contextLucyLabel: { color: LUCY_COLORS.primaryGlow, fontSize: 12, fontWeight: '700', letterSpacing: 0.3, textTransform: 'uppercase', marginBottom: 2 },
  contextSnippet: { color: LUCY_COLORS.textMuted, fontSize: 13, fontStyle: 'italic' },
  contextSource: { color: LUCY_COLORS.textSubtle, fontSize: 11, fontWeight: '600', marginBottom: 4 },
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
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10, marginTop: 8 },
  sectionTitleAccent: { width: 3, height: 16, borderRadius: 2, backgroundColor: LUCY_COLORS.primary },
  sectionTitle: { color: LUCY_COLORS.textDark, fontSize: 16, fontWeight: '800', flex: 1 },
  sectionTitleBadge: { backgroundColor: LUCY_COLORS.primarySoft, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  sectionTitleBadgeText: { color: LUCY_COLORS.primaryGlow, fontSize: 11, fontWeight: '800' },
  empty: { color: LUCY_COLORS.textMuted, backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 18, padding: 17, marginBottom: 17, lineHeight: 20 },
  reminderRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 16, borderWidth: 1, borderColor: LUCY_COLORS.border, padding: 15, marginBottom: 10 },
  reminderText: { color: LUCY_COLORS.textDark, fontSize: 15, fontWeight: '600', lineHeight: 20 },
  reminderMeta: { color: LUCY_COLORS.textMuted, fontSize: 12, marginTop: 4 },
  reminderDone: { backgroundColor: LUCY_COLORS.primarySoft, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 14 },
  reminderDoneText: { color: LUCY_COLORS.primaryGlow, fontWeight: '700', fontSize: 13 },
  galleryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  galleryCell: { width: '32%', aspectRatio: 1, borderRadius: 12, overflow: 'hidden', backgroundColor: LUCY_COLORS.surfaceRaised, borderWidth: 1, borderColor: LUCY_COLORS.border },
  galleryThumb: { width: '100%', height: '100%' },
  medAddBtn: { backgroundColor: LUCY_COLORS.primarySoft, borderRadius: 13, paddingVertical: 11, alignItems: 'center', marginBottom: 12, borderWidth: 1, borderColor: LUCY_COLORS.primaryLine },
  medAddBtnText: { color: LUCY_COLORS.primaryGlow, fontWeight: '800', fontSize: 14 },
  medForm: { backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 16, borderWidth: 1, borderColor: LUCY_COLORS.border, padding: 14, marginBottom: 14, gap: 10 },
  medInput: { backgroundColor: LUCY_COLORS.surface, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 11, color: LUCY_COLORS.textDark, fontSize: 14, borderWidth: 1, borderColor: LUCY_COLORS.border },
  medNote: { color: LUCY_COLORS.textSubtle, fontSize: 11, lineHeight: 16, fontStyle: 'italic' },
  medCard: { backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 16, borderWidth: 1, borderColor: LUCY_COLORS.border, padding: 15, marginBottom: 10 },
  medName: { color: LUCY_COLORS.textDark, fontSize: 16, fontWeight: '800', flex: 1 },
  medDose: { color: LUCY_COLORS.textMuted, fontSize: 14, fontWeight: '600' },
  medRemove: { color: LUCY_COLORS.textSubtle, fontSize: 12, fontWeight: '700' },
  medTimes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  medTimeChip: { backgroundColor: LUCY_COLORS.surface, borderRadius: 11, paddingVertical: 8, paddingHorizontal: 14, borderWidth: 1, borderColor: LUCY_COLORS.primaryLine },
  medTimeChipDone: { backgroundColor: 'rgba(52,199,89,0.12)', borderColor: 'rgba(52,199,89,0.4)' },
  medTimeText: { color: LUCY_COLORS.primaryGlow, fontWeight: '700', fontSize: 13 },
  medTimeTextDone: { color: '#2FBF71' },
  pendingHint: { color: LUCY_COLORS.textMuted, fontSize: 13, marginBottom: 17, paddingHorizontal: 3 },
  library: { flex: 1 },
  wsBack: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 4, marginBottom: 8 },
  wsBackText: { color: LUCY_COLORS.primary, fontSize: 14, fontWeight: '700' },
  wsBackTitle: { color: LUCY_COLORS.textDark, fontSize: 16, fontWeight: '700' },
  tabs: { flexGrow: 0, marginBottom: 15 },
  tab: { paddingHorizontal: 15, paddingVertical: 10, borderRadius: 20, marginRight: 7, backgroundColor: LUCY_COLORS.surfaceRaised },
  activeTab: { backgroundColor: LUCY_COLORS.primary },
  tabText: { color: LUCY_COLORS.textMuted, fontWeight: '600' },
  activeText: { color: LUCY_COLORS.white },
  card: { backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 18, borderWidth: 1, borderColor: LUCY_COLORS.border, borderTopColor: LUCY_COLORS.primaryLine, padding: 15, marginBottom: 10, gap: 7, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.22, shadowRadius: 7, elevation: 3 },
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
  tlReceiptBtn: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginRight: 6, backgroundColor: LUCY_COLORS.surface, borderWidth: 1, borderColor: LUCY_COLORS.border },
  readingOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  readingCard: { backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 18, paddingVertical: 26, paddingHorizontal: 30, alignItems: 'center', borderWidth: 1, borderColor: LUCY_COLORS.border, maxWidth: 280 },
  readingText: { color: LUCY_COLORS.textDark, fontSize: 16, fontWeight: '600', marginTop: 16 },
  readingSubText: { color: LUCY_COLORS.textSubtle, fontSize: 13, marginTop: 5, textAlign: 'center' },
  tlViewOriginal: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, alignSelf: 'flex-start', paddingVertical: 5, paddingHorizontal: 10, borderRadius: 9, backgroundColor: LUCY_COLORS.surface, borderWidth: 1, borderColor: LUCY_COLORS.border },
  tlViewOriginalText: { color: LUCY_COLORS.primary, fontSize: 12.5, fontWeight: '600' },
  imageViewerBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  imageViewerImg: { width: '94%', height: '80%' },
  imageViewerHint: { color: 'rgba(255,255,255,0.6)', fontSize: 13, marginTop: 14 },
  tlReceiptIcon: { fontSize: 16 },
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
  actionSheet: { backgroundColor: LUCY_COLORS.surfaceElevated ?? '#2A2219', borderRadius: 20, paddingVertical: 8, width: '100%', borderWidth: 1, borderColor: LUCY_COLORS.border, shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.40, shadowRadius: 16, elevation: 12 },
  actionSheetTitle: { color: LUCY_COLORS.textSubtle, fontSize: 12, fontWeight: '700', paddingHorizontal: 20, paddingTop: 10, paddingBottom: 8 },
  actionSheetItem: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 14 },
  actionSheetIcon: { width: 22, textAlign: 'center', color: LUCY_COLORS.textMuted, fontSize: 16, fontWeight: '700' },
  actionSheetLabel: { color: LUCY_COLORS.textDark, fontSize: 15, fontWeight: '600' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  feedbackModal: { backgroundColor: LUCY_COLORS.surfaceElevated ?? '#2A2219', borderRadius: 20, padding: 24, width: '100%', borderWidth: 1, borderColor: LUCY_COLORS.border, gap: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.40, shadowRadius: 16, elevation: 12 },
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
