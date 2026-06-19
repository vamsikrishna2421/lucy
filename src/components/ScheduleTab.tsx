/**
 * ScheduleTab - Lucy's on-device calendar surface.
 * Visual redesign only: keeps the same scheduling engine calls and data shapes.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { LUCY_COLORS } from '../config/colors';
import { getDatabase } from '../db';
import {
  getPlan, suggestForText, suggestForTodo, commitBlock, cancelBlock, commitSeries, autoPlanDay,
  addFixedBlock, unscheduledPendingTodos, describeResources, type DayProposal,
} from '../scheduling';
import { classifyTask } from '../scheduling/classify';
import { updateScheduledBlock } from '../db/schedule';
import { getAvailability } from '../scheduling/availability';
import { hasCalendarPermission, requestCalendarPermission } from '../processing/calendarConnector';
import { getSetting, setSetting } from '../db/settings';
import type { AvailabilityProfile, Block, SlotSuggestion, TaskResources } from '../scheduling/types';
import { SegmentedControl, type SegmentOption } from './SegmentedControl';
import { ActionSheet, Toast, type SheetAction } from './ActionSheet';
import { LucyPeek } from './LucyPeek';

function clock(ms: number): string { return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
function dayKey(ms: number): number { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }
function dayLabel(ms: number): string {
  const t = dayKey(Date.now()); const d = dayKey(ms);
  if (d === t) return 'Today'; if (d === t + 86400000) return 'Tomorrow';
  return new Date(ms).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}
function hm(min: number): string { return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`; }

const CATS: Array<[string, RegExp]> = [
  ['#22C55E', /walk|gym|run|workout|yoga|exercise|meditat/],
  ['#F5C451', /lunch|dinner|breakfast|meal|coffee|brunch/],
  ['#FF8C42', /call|meeting|standup|sync|interview|brief|1:1/],
  ['#A78BFA', /errand|buy|pick|store|grocery|bank|clinic|@/],
  ['#4DA3FF', /focus|deep|write|code|study|design|review|plan|research|report/],
];
function catColor(title: string, label: string): string {
  const s = `${title} ${label}`.toLowerCase();
  for (const [c, re] of CATS) if (re.test(s)) return c;
  return '#8AA4FF';
}

const CAL_VIEW_OPTIONS: SegmentOption<'agenda' | 'day' | 'week' | 'month'>[] = [
  { value: 'day', label: 'Day' },
  { value: 'agenda', label: 'Upcoming' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

interface Sugg {
  meta: { title: string; durationMin: number; resources: TaskResources; energy: string; location?: string | null };
  suggestions: SlotSuggestion[];
  todoId?: number | null;
  windowLabel?: string; // set when the user refined the window ("the last week of June")
}

export function ScheduleTab() {
  const [loading, setLoading] = useState(true);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [conflicts, setConflicts] = useState<Array<{ a: Block; b: Block }>>([]);
  const [av, setAv] = useState<AvailabilityProfile | null>(null);
  const [unsched, setUnsched] = useState<Array<{ id: number; task: string }>>([]);
  const [task, setTask] = useState('');
  const [sugg, setSugg] = useState<Sugg | null>(null);
  const [refineText, setRefineText] = useState('');
  const [proposals, setProposals] = useState<DayProposal[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<'agenda' | 'day' | 'week' | 'month'>('day');
  const [ref, setRef] = useState<number>(dayKey(Date.now()));
  const [calPerm, setCalPerm] = useState<boolean | null>(null);
  const [calSync, setCalSync] = useState(true); // device-calendar sync kill-switch
  // Designed info/confirm sheet + success toast — replaces Alert.alert on this surface.
  const [infoSheet, setInfoSheet] = useState<{ context?: string; title: string; message?: string; accent?: string; actions: SheetAction[]; cancelLabel?: string | null } | null>(null);
  const [calToast, setCalToast] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number>(Date.now());
  const [planOpen, setPlanOpen] = useState(false); // "Plan with Lucy" collapsible (calendar-first)
  const [detail, setDetail] = useState<{ id: number; title: string; start: number; end: number; resources: TaskResources } | null>(null);
  const [nameEdit, setNameEdit] = useState('');
  const [resolve, setResolve] = useState<{ a: Block; b: Block } | null>(null); // conflict being resolved
  const [resolveSugg, setResolveSugg] = useState<{ a: SlotSuggestion[]; b: SlotSuggestion[]; loading: boolean }>({ a: [], b: [], loading: false });
  const [habitSuggest, setHabitSuggest] = useState<{ title: string; start: number; end: number; resources: TaskResources } | null>(null);
  const [learned, setLearned] = useState<Array<{ title: string; startMin: number; endMin: number; days: number[] }>>([]);
  // Tap-to-create: a Lucy-peeking card to schedule an event on the time you tapped (day view only).
  const [createDraft, setCreateDraft] = useState<{ startMs: number; durationMin: number; title: string } | null>(null);
  const createAnim = useRef(new Animated.Value(0)).current; // card entrance (fade + rise + scale)

  const load = useCallback(async () => {
    const db = await getDatabase();
    const now = Date.now();
    const [plan, a, us, perm] = await Promise.all([
      getPlan(db, now - 2 * 3600_000, now + 42 * 86400_000),
      getAvailability(db),
      unscheduledPendingTodos(db),
      hasCalendarPermission(),
    ]);
    setBlocks(plan.blocks);
    setConflicts(plan.conflicts.map((c) => ({ a: c.a, b: c.b })));
    setAv(a);
    setUnsched(us.slice(0, 12));
    setCalPerm(perm);
    try { setCalSync((await getSetting(db, 'device_calendar_sync')) !== 'off'); } catch { /* default on */ }
    try {
      const { deriveLearnedHabits } = await import('../scheduling/learnedHabits');
      setLearned(await deriveLearnedHabits(db));
    } catch { /* suggestions optional */ }
    // Keep the Dynamic Island countdown in sync with the latest schedule (foreground-only).
    void import('../audio/liveActivity').then(({ syncNextEventLiveActivity }) => syncNextEventLiveActivity()).catch(() => {});
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  // Keep the "now" line live (updates every minute) for the day/week grid.
  useEffect(() => { const t = setInterval(() => setNowMs(Date.now()), 60_000); return () => clearInterval(t); }, []);
  // Spring the "new event" card up + fade in when it opens (native driver). Lucy handles her own peek.
  useEffect(() => {
    if (createDraft) {
      createAnim.setValue(0);
      Animated.spring(createAnim, { toValue: 1, tension: 70, friction: 12, useNativeDriver: true }).start();
    }
  }, [createDraft, createAnim]);

  const connectCalendars = async () => {
    const granted = await requestCalendarPermission();
    setCalPerm(granted);
    if (granted) {
      try { const db = await getDatabase(); await setSetting(db, 'device_calendar_sync', 'on'); } catch { /* ignore */ }
      setCalSync(true);
      await load();
    }
    else {
      setInfoSheet({
        context: 'Calendar sync',
        title: 'Connect Google / Teams / Outlook',
        message: 'To show those events here, add the account to your phone first:\n\niPhone: Settings → Calendar → Accounts → Add Account (Google or Outlook), then turn Calendars ON.\nAndroid: Settings → Accounts → add Google/Outlook with Calendar sync.\n\nThen allow LUCY calendar access when asked.',
        actions: [{ label: 'Got it', style: 'primary' }],
        cancelLabel: null,
      });
    }
  };

  // Kill-switch: turn device-calendar sync on/off (reading some device events can crash expo-calendar).
  const toggleCalSync = async () => {
    const next = !calSync;
    setCalSync(next);
    try { const db = await getDatabase(); await setSetting(db, 'device_calendar_sync', next ? 'on' : 'off'); } catch { /* ignore */ }
    await load();
  };

  const doSuggest = async (text: string, todoId?: number) => {
    if (!text.trim() && !todoId) return;
    setBusy(true); setProposals(null);
    try {
      const db = await getDatabase();
      const r = todoId ? await suggestForTodo(db, todoId) : await suggestForText(db, text);
      if (r) setSugg({ meta: r.meta, suggestions: r.suggestions, todoId: todoId ?? null });
    } finally { setBusy(false); }
  };

  // Refine the current suggestion with a natural-language timing comment ("last week of this month",
  // "not tomorrow", "after the 25th") — re-suggests inside that window.
  const refineSuggestion = async (comment: string) => {
    if (!sugg || !comment.trim()) return;
    setBusy(true);
    try {
      const { parseTimingConstraint } = await import('../scheduling/timingConstraint');
      const c = parseTimingConstraint(comment);
      if (!c) { setInfoSheet({ title: 'When should it be?', message: 'Try things like "last week of this month", "not tomorrow", "after the 25th", or "next week".', actions: [{ label: 'Got it', style: 'primary' }], cancelLabel: null }); return; }
      const db = await getDatabase();
      const r = await suggestForText(db, sugg.meta.title, { durationMin: sugg.meta.durationMin, earliestStart: c.earliestStart, horizonDays: c.horizonDays });
      setSugg({ meta: r.meta, suggestions: r.suggestions, todoId: sugg.todoId, windowLabel: c.label });
      setRefineText('');
    } finally { setBusy(false); }
  };

  const accept = async (s: SlotSuggestion) => {
    if (!sugg) return;
    setBusy(true);
    try {
      const db = await getDatabase();
      await commitBlock(db, {
        title: sugg.meta.title,
        startMs: s.start,
        endMs: s.end,
        resources: sugg.meta.resources,
        energy: sugg.meta.energy,
        location: sugg.meta.location ?? null,
        todoId: sugg.todoId ?? null,
      });
      setSugg(null); setTask(''); await load();
    } finally { setBusy(false); }
  };

  const planDay = async () => {
    setBusy(true); setSugg(null);
    try { const db = await getDatabase(); const r = await autoPlanDay(db); setProposals(r.proposals); } finally { setBusy(false); }
  };
  const acceptProposal = async (p: DayProposal) => {
    setBusy(true);
    try {
      const db = await getDatabase();
      await commitBlock(db, { title: p.title, startMs: p.start, endMs: p.end, resources: p.resources, energy: p.energy, todoId: p.todoId });
      setProposals((prev) => prev?.filter((x) => x !== p) ?? null);
      await load();
    } finally { setBusy(false); }
  };
  const acceptAll = async () => {
    if (!proposals) return;
    setBusy(true);
    try {
      const db = await getDatabase();
      for (const p of proposals) {
        try { await commitBlock(db, { title: p.title, startMs: p.start, endMs: p.end, resources: p.resources, energy: p.energy, todoId: p.todoId }); } catch { /* skip */ }
      }
      setProposals(null); await load();
    } finally { setBusy(false); }
  };
  const remove = async (id: number) => {
    setBusy(true);
    try { const db = await getDatabase(); await cancelBlock(db, id); await load(); } finally { setBusy(false); }
  };
  // Habit windows are SUGGESTIONS only — nothing is on the calendar until the user taps ✓ to add it.
  const approveHabit = async (it: { title: string; start: number; end: number }) => {
    setBusy(true);
    try {
      const db = await getDatabase();
      // Dedup: don't stack a second identical block if one with the same title already overlaps this
      // slot (this caused "Gym overlaps Gym" pileups when a suggestion was approved more than once).
      const dupe = await db.getFirstAsync<{ id: number }>(
        "SELECT id FROM scheduled_blocks WHERE status='committed' AND lower(title)=lower(?) AND start_at < ? AND end_at > ?",
        it.title, it.end, it.start,
      );
      if (!dupe) {
        const { classifyTask } = await import('../scheduling/classify');
        const meta = classifyTask(it.title);
        await commitBlock(db, { title: it.title, startMs: it.start, endMs: it.end, resources: meta.resources, energy: meta.energy, location: meta.location ?? null }, { force: true });
      }
      await load();
    } finally { setBusy(false); }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={LUCY_COLORS.primary} /></View>;

  const conflictTitles = new Set<string>(); conflicts.forEach((c) => { conflictTitles.add(c.a.title); conflictTitles.add(c.b.title); });
  const today = dayKey(Date.now());
  const todayCount = blocks.filter((b) => dayKey(b.start) === today).length;
  const nextBlock = blocks.filter((b) => b.start >= Date.now()).sort((a, b) => a.start - b.start)[0];
  const focusMinutes = blocks
    .filter((b) => dayKey(b.start) === today && /focus|deep|write|code|study|design|review|plan|research/.test(`${b.title} ${describeResources(b.resources)}`.toLowerCase()))
    .reduce((sum, b) => sum + (b.end - b.start) / 60000, 0);

  const HOURS: number[] = []; for (let h = 6; h < 24; h++) HOURS.push(h);
  const G_START = 6 * 60; const PXM = 0.7; const G_H = (24 * 60 - G_START) * PXM;
  const localMin = (ms: number) => { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes(); };

  // ── Tap an empty slot → Lucy-peeking "new event" card ───────────────────────
  // Snap a tap's vertical offset (px from the top of the grid) to a clock time on day `k`,
  // rounded to the nearest 30 min, then open the create card prefilled there (default 60 min).
  const openCreateAt = (k: number, locationY: number) => {
    const rawMin = G_START + locationY / PXM;
    const snapped = Math.round(rawMin / 30) * 30;
    const clamped = Math.max(G_START, Math.min(snapped, 24 * 60 - 30));
    const start = dayKey(k) + clamped * 60000;
    setCreateDraft({ startMs: start, durationMin: 60, title: '' });
  };
  // Nudge the draft start time by ±15 min, kept inside the visible grid hours.
  const nudgeDraft = (deltaMin: number) => {
    setCreateDraft((d) => {
      if (!d) return d;
      const min0 = localMin(d.startMs);
      const min1 = Math.max(G_START, Math.min(min0 + deltaMin, 24 * 60 - 15));
      return { ...d, startMs: dayKey(d.startMs) + min1 * 60000 };
    });
  };
  const addCreatedEvent = async () => {
    if (!createDraft) return;
    const title = createDraft.title.trim() || 'New event';
    const startMs = createDraft.startMs;
    const endMs = startMs + createDraft.durationMin * 60000;
    setBusy(true);
    try {
      const db = await getDatabase();
      // Classify so the event joins the conflict/effort model. An empty resource axis set means it
      // can run alongside other things (lunch, laundry); anything exclusive holds focus/self.
      const meta = classifyTask(title, { durationMin: createDraft.durationMin });
      const parallelizable = (meta.resources.axes ?? []).length === 0;
      // The user picked this slot deliberately, so force-add it (ground truth); any overlap just
      // shows up in the plan's overlap card for one-tap resolve — nothing scary is surfaced here.
      await addFixedBlock(db, { title, startMs, endMs, parallelizable, location: meta.location ?? meta.resources.location ?? null });
      setCreateDraft(null);
      setRef(dayKey(startMs));
      await load();
    } finally { setBusy(false); }
  };

  type Item = { id?: number; title: string; start: number; end: number; resources: Block['resources']; habit: boolean; device?: boolean };
  const habitsFor = (k: number): Item[] => {
    const dow = new Date(k).getDay();
    // Suggestions now come from the user's OWN learned routine (deriveLearnedHabits), not hardcoded
    // windows — proposed for the days/time they usually do each activity. Past days get no suggestion.
    if (k < dayKey(Date.now())) return [];
    return learned.filter((h) => h.days.includes(dow)).map((h) => ({
      title: h.title, start: k + h.startMin * 60000, end: k + h.endMin * 60000, habit: true, resources: { axes: [], location: null },
    }));
  };
  const dayItems = (k: number): Item[] => {
    const real = blocks
      .filter((b) => dayKey(b.start) === k)
      .map((b): Item => ({ id: b.id, title: b.title, start: b.start, end: b.end, resources: b.resources, habit: false, device: b.source === 'calendar' }));
    // Hide a habit suggestion once it's been approved (a real block with the same title exists that day).
    const realTitles = new Set(real.map((r) => r.title.toLowerCase()));
    const habits = habitsFor(k).filter((h) => !realTitles.has(h.title.toLowerCase()));
    return [...real, ...habits].sort((a, b) => a.start - b.start);
  };
  const weekDays = (): number[] => {
    const dow = new Date(ref).getDay();
    const s = ref - dow * 86400000;
    return [0, 1, 2, 3, 4, 5, 6].map((i) => s + i * 86400000);
  };
  const navCal = (dir: number) => {
    if (view === 'month') { const d = new Date(ref); d.setMonth(d.getMonth() + dir); setRef(dayKey(d.getTime())); }
    else setRef(ref + dir * (view === 'week' ? 7 : 1) * 86400000);
  };
  const rangeLabel = () => {
    const d = new Date(ref);
    if (view === 'month') return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    if (view === 'week') {
      const w = weekDays();
      return `${new Date(w[0]).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} - ${new Date(w[6]).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
    }
    if (view === 'day') return dayLabel(ref);
    return 'Next 7 days';
  };
  const DEVICE_COLOR = '#5B8CFF'; // connected Google/Teams/Outlook events
  const onBlockPress = (it: Item) => {
    if (it.habit) {
      setHabitSuggest({ title: it.title, start: it.start, end: it.end, resources: it.resources });
      return;
    }
    if (it.device) {
      setInfoSheet({
        context: `${clock(it.start)} – ${clock(it.end)}`,
        title: it.title,
        message: 'From a calendar you connected (Google / Teams / Outlook). LUCY schedules around it but won\'t change it.',
        accent: '#5B8CFF',
        actions: [{ label: 'Close', style: 'primary' }],
        cancelLabel: null,
      });
      return;
    }
    if (!it.id) return;
    // Open the rich event card for LUCY's own events (rename / recurring / reschedule / delete).
    setDetail({ id: it.id, title: it.title, start: it.start, end: it.end, resources: it.resources });
    setNameEdit(it.title);
  };

  // ── Event-card actions ──────────────────────────────────────────────────────
  const saveName = async () => {
    if (!detail || !nameEdit.trim() || nameEdit.trim() === detail.title) return;
    setBusy(true);
    try {
      const db = await getDatabase();
      await updateScheduledBlock(db, detail.id, { title: nameEdit.trim() });
      setDetail({ ...detail, title: nameEdit.trim() });
      await load();
    } finally { setBusy(false); }
  };
  const shiftEvent = async (deltaMs: number) => {
    if (!detail) return;
    setBusy(true);
    try {
      const db = await getDatabase();
      const start = detail.start + deltaMs; const end = detail.end + deltaMs;
      await updateScheduledBlock(db, detail.id, { startMs: start, endMs: end });
      setDetail({ ...detail, start, end });
      setRef(dayKey(start));
      await load();
    } finally { setBusy(false); }
  };
  const makeRecurring = async (rule: 'daily' | 'weekdays' | 'weekly') => {
    if (!detail) return;
    setBusy(true);
    try {
      const db = await getDatabase();
      const r = await commitSeries(db, { title: detail.title, startMs: detail.start, endMs: detail.end, resources: detail.resources }, rule);
      setDetail(null);
      await load();
      setCalToast(`Made recurring — ${r.count} upcoming`);
    } finally { setBusy(false); }
  };
  const deleteEvent = async () => {
    if (!detail) return;
    const id = detail.id;
    setDetail(null);
    await remove(id);
  };
  // Move one side of an overlap to a new time (resolve a conflict). Only LUCY blocks (with an id) move;
  // device (Google/Teams) events are read-only.
  const moveBlockTo = async (block: Block, startMs: number, endMs: number) => {
    if (!block.id) return;
    setBusy(true);
    try {
      const db = await getDatabase();
      await updateScheduledBlock(db, block.id, { startMs, endMs });
      setResolve(null);
      setRef(dayKey(startMs));
      await load();
    } finally { setBusy(false); }
  };
  // Open the resolver and fetch the top conflict-free reschedule slots for BOTH overlapping events.
  const openResolve = async (c: { a: Block; b: Block }) => {
    setResolve(c);
    setResolveSugg({ a: [], b: [], loading: true });
    try {
      const db = await getDatabase();
      const slotsFor = async (x: Block): Promise<SlotSuggestion[]> => {
        if (!x.id) return [];
        const dur = Math.max(5, Math.round((x.end - x.start) / 60000));
        try { const r = await suggestForText(db, x.title, { durationMin: dur, maxResults: 3 }); return r.suggestions.slice(0, 3); } catch { return []; }
      };
      const [a, b] = await Promise.all([slotsFor(c.a), slotsFor(c.b)]);
      setResolveSugg({ a, b, loading: false });
    } catch { setResolveSugg({ a: [], b: [], loading: false }); }
  };

  const DayCol = ({ k, w, creatable }: { k: number; w?: number; creatable?: boolean }) => (
    <View style={[styles.dayCol, { height: G_H }, w ? { width: w } : { flex: 1 }]}>
      {HOURS.map((h) => <View key={h} style={[styles.hourLine, { top: (h * 60 - G_START) * PXM }]} />)}
      {/* Tap-to-create layer (day view): full-height, sits BEHIND the event blocks so existing events
          win the touch. Tapping empty time opens the Lucy-peeking "new event" card at that hour. */}
      {creatable ? (
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={(e) => openCreateAt(k, e.nativeEvent.locationY)}
        />
      ) : null}
      {dayItems(k).map((it, i) => {
        const top = Math.max(0, (localMin(it.start) - G_START) * PXM);
        const ht = Math.max(20, ((it.end - it.start) / 60000) * PXM);
        const c = it.habit ? LUCY_COLORS.textSubtle : it.device ? DEVICE_COLOR : catColor(it.title, describeResources(it.resources));
        const tall = ht > 30;
        return (
          <TouchableOpacity key={i} activeOpacity={0.82} onPress={() => onBlockPress(it)} style={[styles.gridEvent, { top, height: ht, backgroundColor: `${c}1F`, borderColor: `${c}3A`, borderLeftColor: c }, it.habit && styles.gridHabit]}>
            <Text numberOfLines={tall ? 2 : 1} style={[styles.gridEventTitle, { color: it.habit ? LUCY_COLORS.textMuted : LUCY_COLORS.textDark }]}>{it.habit ? '✓ ' : it.device ? '📅 ' : ''}{it.title}</Text>
            {tall ? <Text style={styles.gridEventTime}>{clock(it.start)}</Text> : null}
          </TouchableOpacity>
        );
      })}
      {/* Live "now" line — only on today, within the visible grid hours. */}
      {dayKey(k) === today && localMin(nowMs) >= G_START ? (
        <View style={[styles.nowLine, { top: (localMin(nowMs) - G_START) * PXM }]} pointerEvents="none">
          <View style={styles.nowDot} />
        </View>
      ) : null}
    </View>
  );
  const HourLabels = () => (
    <View style={[styles.hourLabels, { height: G_H }]}>
      {HOURS.map((h) => (
        <Text key={h} style={[styles.hourLabel, { top: (h * 60 - G_START) * PXM - 6 }, h === new Date(nowMs).getHours() && dayKey(ref) === today && styles.hourLabelNow]}>
          {(h % 12) || 12}{h < 12 ? ' AM' : ' PM'}
        </Text>
      ))}
    </View>
  );

  // Fantastical-style week strip: 7 days for context, tap to focus a day; dots preview that day's events.
  const WeekStrip = () => (
    <View style={styles.weekStrip}>
      {weekDays().map((k) => {
        const isToday = dayKey(k) === today;
        const isSel = dayKey(k) === dayKey(ref);
        const evs = dayItems(k).filter((x) => !x.habit);
        return (
          <TouchableOpacity key={k} style={styles.wsDay} activeOpacity={0.7} onPress={() => { setRef(dayKey(k)); if (view === 'month' || view === 'agenda') setView('day'); }}>
            <Text style={[styles.wsDow, isSel && styles.wsDowSel]}>{new Date(k).toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 1)}</Text>
            <View style={[styles.wsNum, isToday && styles.wsNumToday, isSel && !isToday && styles.wsNumSel]}>
              <Text style={[styles.wsNumT, (isToday || isSel) && styles.wsNumTOn]}>{new Date(k).getDate()}</Text>
            </View>
            <View style={styles.wsDots}>
              {evs.slice(0, 3).map((it, i) => <View key={i} style={[styles.wsDot, { backgroundColor: it.device ? DEVICE_COLOR : catColor(it.title, describeResources(it.resources)) }]} />)}
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const renderBody = () => {
    if (view === 'month') {
      const d = new Date(ref); const y = d.getFullYear(); const m = d.getMonth();
      const startDow = new Date(y, m, 1).getDay(); const dim = new Date(y, m + 1, 0).getDate();
      const cells: Array<number | null> = [];
      for (let i = 0; i < startDow; i++) cells.push(null);
      for (let dd = 1; dd <= dim; dd++) cells.push(new Date(y, m, dd, 12).getTime());
      while (cells.length % 7) cells.push(null);
      return (
        <View style={styles.monthWrap}>
          <View style={styles.monthDays}>{['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((w, i) => <Text key={i} style={styles.monthDayText}>{w}</Text>)}</View>
          <View style={styles.monthGrid}>
            {cells.map((k, i) => {
              if (!k) return <View key={i} style={styles.monthCellBlank} />;
              const dk = dayKey(k); const cnt = dayItems(dk).filter((x) => !x.habit).length; const isT = dk === today;
              return (
                <TouchableOpacity key={i} onPress={() => { setRef(dk); setView('day'); }} style={styles.monthCellOuter}>
                  <View style={[styles.monthCell, isT && styles.monthCellToday]}>
                    <Text style={[styles.monthCellDate, isT && styles.monthCellDateToday]}>{new Date(k).getDate()}</Text>
                    {cnt > 0 ? <Text style={styles.monthCellCount}>{cnt}</Text> : null}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      );
    }
    if (view === 'day') return (
      <>
        <View style={styles.gridWrap}><HourLabels /><DayCol k={ref} creatable /></View>
        <Text style={styles.gridHint}>Tap any open time to add an event</Text>
      </>
    );
    if (view === 'week') {
      return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.weekScroll} contentContainerStyle={styles.weekContent}>
          <HourLabels />
          {weekDays().map((k) => (
            <View key={k} style={styles.weekDay}>
              <Text style={[styles.weekDayText, dayKey(k) === today && styles.weekDayTextToday]}>{new Date(k).toLocaleDateString(undefined, { weekday: 'short' })} {new Date(k).getDate()}</Text>
              <DayCol k={k} w={116} />
            </View>
          ))}
        </ScrollView>
      );
    }
    const ds = [0, 1, 2, 3, 4, 5, 6].map((i) => today + i * 86400000);
    const any = ds.some((k) => dayItems(k).length);
    if (!any) return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyEmoji}>🌤️</Text>
        <Text style={styles.emptyTitle}>The week ahead is clear</Text>
        <Text style={styles.emptyBody}>Nothing scheduled for the next 7 days. Open “Plan with Lucy” below to place a task or auto-plan your day.</Text>
      </View>
    );
    return (
      <>
        {ds.map((k) => {
          const items = dayItems(k);
          if (!items.length) return null;
          return (
            <View key={k} style={styles.agendaDay}>
              <Text style={styles.dayH}>{dayLabel(k)}</Text>
              {items.map((b, i) => {
                const conf = conflictTitles.has(b.title);
                const c = b.habit ? '#8a8a8a' : b.device ? DEVICE_COLOR : catColor(b.title, describeResources(b.resources));
                return (
                  <TouchableOpacity key={i} activeOpacity={0.85} onPress={() => onBlockPress(b)} style={[styles.block, { borderLeftColor: c }, conf && styles.blockConflict, b.habit && styles.blockHabit]}>
                    <View style={styles.blockTimeWrap}>
                      <Text style={styles.blockTime}>{clock(b.start)}</Text>
                      <Text style={styles.blockTimeEnd}>{clock(b.end)}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.blockT}>{b.device ? '📅 ' : ''}{b.title}{conf ? ' • conflict' : ''}</Text>
                      <Text style={styles.rowD}>{b.habit ? 'Suggested from your routine' : b.device ? 'From your calendar' : `${describeResources(b.resources)} • Lucy`}</Text>
                    </View>
                    {b.habit
                      ? <TouchableOpacity style={styles.approveBtn} onPress={() => approveHabit(b)}><Text style={styles.approveT}>✓ Add</Text></TouchableOpacity>
                      : b.id ? <TouchableOpacity onPress={() => remove(b.id!)}><Text style={styles.x}>Remove</Text></TouchableOpacity> : null}
                  </TouchableOpacity>
                );
              })}
            </View>
          );
        })}
      </>
    );
  };

  // Reschedule options for one side of an overlap: Lucy's top conflict-free slots PLUS quick
  // before/after fallbacks. Only LUCY blocks (with an id) can move; device events are read-only.
  const MoveOptions = ({ x, o, sugg }: { x: Block; o: Block; sugg: SlotSuggestion[] }) => {
    if (!x.id) return null;
    const dur = x.end - x.start;
    const afterS = o.end; const beforeS = o.start - dur;
    const accent = catColor(x.title, describeResources(x.resources));
    return (
      <View style={styles.moveGroup}>
        <View style={styles.moveHead}>
          <View style={[styles.sheetTagDot, { backgroundColor: accent }]} />
          <Text style={styles.moveHeadT} numberOfLines={1}>Move {x.title}</Text>
        </View>
        {resolveSugg.loading ? (
          <View style={styles.moveLoadRow}><ActivityIndicator size="small" color={LUCY_COLORS.primary} /><Text style={styles.moveLoadT}>Finding free times…</Text></View>
        ) : null}
        <View style={styles.eventChipRow}>
          {sugg.map((s, i) => (
            <TouchableOpacity key={i} style={styles.moveChipBest} activeOpacity={0.7} onPress={() => moveBlockTo(x, s.start, s.end)}>
              <Text style={styles.moveChipBestT}>{dayLabel(s.start)} · {clock(s.start)}</Text>
            </TouchableOpacity>
          ))}
          {/* Deterministic fallbacks (always valid even if no free slot was found). */}
          <TouchableOpacity style={styles.eventChip} activeOpacity={0.7} onPress={() => moveBlockTo(x, afterS, afterS + dur)}>
            <Text style={styles.eventChipT}>After · {clock(afterS)}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.eventChip} activeOpacity={0.7} onPress={() => moveBlockTo(x, beforeS, beforeS + dur)}>
            <Text style={styles.eventChipT}>Before · {clock(beforeS)}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const loosePlanCount = unsched.length;
  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      {/* Slim, calendar-first header */}
      <View style={styles.headRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>Lucy Calendar</Text>
          <Text style={styles.headTitle} numberOfLines={1}>{nextBlock ? `Next: ${nextBlock.title}` : todayCount ? 'Your day has shape.' : 'Your day is open.'}</Text>
          <Text style={styles.headSub} numberOfLines={1}>{nextBlock ? `${dayLabel(nextBlock.start)} at ${clock(nextBlock.start)} · ${(focusMinutes / 60).toFixed(1)}h focus` : 'Nothing pressing right now.'}</Text>
        </View>
        <Text style={[styles.heroMeta, conflicts.length ? { color: LUCY_COLORS.error, borderColor: `${LUCY_COLORS.error}55`, backgroundColor: `${LUCY_COLORS.error}14` } : { color: LUCY_COLORS.success, borderColor: `${LUCY_COLORS.success}44`, backgroundColor: `${LUCY_COLORS.success}12` }]}>{conflicts.length ? `${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'}` : 'Conflict-free'}</Text>
      </View>

      {calPerm === false ? (
        <TouchableOpacity style={styles.connectCard} onPress={connectCalendars} activeOpacity={0.85}>
          <Text style={styles.connectIcon}>📅</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.connectTitle}>Connect Google, Teams & Outlook</Text>
            <Text style={styles.connectSub}>Show your real meetings here and let Lucy schedule around them. Tap to connect.</Text>
          </View>
          <Text style={styles.connectChevron}>›</Text>
        </TouchableOpacity>
      ) : calPerm ? (
        <TouchableOpacity style={styles.syncedPill} activeOpacity={0.7} onPress={toggleCalSync}>
          <View style={[styles.syncedDot, !calSync && { backgroundColor: LUCY_COLORS.textSubtle }]} />
          <Text style={styles.syncedText}>{calSync ? 'Synced with your calendars · tap to pause' : 'Device calendar paused · tap to resume'}</Text>
        </TouchableOpacity>
      ) : null}

      {/* Calendar — leads the screen */}
      <View style={styles.timetableCard}>
        <View style={styles.timetableHead}>
          <Text style={styles.rangeL}>{rangeLabel()}</Text>
          <View style={styles.navGroup}>
            <TouchableOpacity style={styles.navBtn} onPress={() => navCal(-1)}><Text style={styles.navT}>{'‹'}</Text></TouchableOpacity>
            <TouchableOpacity style={styles.navBtn} onPress={() => setRef(today)}><Text style={styles.navT}>Today</Text></TouchableOpacity>
            <TouchableOpacity style={styles.navBtn} onPress={() => navCal(1)}><Text style={styles.navT}>{'›'}</Text></TouchableOpacity>
          </View>
        </View>
        {view !== 'month' ? <WeekStrip /> : null}
        <SegmentedControl
          compact
          style={styles.viewRow}
          value={view}
          onChange={setView}
          options={CAL_VIEW_OPTIONS}
        />
        {renderBody()}
      </View>

      {/* Overlaps — always visible (not buried) so the user can resolve them with one tap */}
      {conflicts.length > 0 ? (
        <View style={[styles.resultCard, styles.conflictCard]}>
          <Text style={[styles.boxH, { color: LUCY_COLORS.error }]}>{conflicts.length} overlap{conflicts.length > 1 ? 's' : ''} — tap Resolve for reschedule options</Text>
          {conflicts.map((c, i) => (
            <View key={i} style={styles.conflictRow}>
              <Text style={[styles.rowD, { flex: 1 }]} numberOfLines={2}>{c.a.title} overlaps {c.b.title}</Text>
              <TouchableOpacity style={styles.btnSm} onPress={() => openResolve(c)}><Text style={styles.btnT}>Resolve</Text></TouchableOpacity>
            </View>
          ))}
        </View>
      ) : null}

      {/* Plan with Lucy — collapsed by default (calendar-first) */}
      <TouchableOpacity style={styles.planToggle} onPress={() => setPlanOpen((o) => !o)} activeOpacity={0.8}>
        <View style={{ flex: 1 }}>
          <Text style={styles.planToggleT}>Plan with Lucy</Text>
          <Text style={styles.planToggleSub}>{loosePlanCount ? `${loosePlanCount} loose task${loosePlanCount === 1 ? '' : 's'} to place` : 'Schedule a task, auto-plan your day'}</Text>
        </View>
        {loosePlanCount ? <View style={styles.planBadge}><Text style={styles.planBadgeT}>{loosePlanCount}</Text></View> : null}
        <Text style={styles.planChevron}>{planOpen ? '▾' : '▸'}</Text>
      </TouchableOpacity>

      {planOpen ? (
        <>
          <View style={styles.plannerCard}>
            <Text style={styles.panelEyebrow}>Schedule something</Text>
            <View style={styles.findRow}>
              <TextInput style={styles.input} placeholder="Write the doc, call mom, gym..." placeholderTextColor={LUCY_COLORS.textFaint} value={task} onChangeText={setTask} onSubmitEditing={() => doSuggest(task)} />
              <TouchableOpacity style={styles.btn} onPress={() => doSuggest(task)} disabled={busy}><Text style={styles.btnT}>Suggest</Text></TouchableOpacity>
            </View>
            <TouchableOpacity style={styles.heroPlan} onPress={planDay} disabled={busy}><Text style={styles.heroPlanText}>Plan my day</Text></TouchableOpacity>
          </View>

          {sugg ? (
            <View style={styles.resultCard}>
              <Text style={styles.boxH}>{sugg.suggestions.length ? `Best times for "${sugg.meta.title}"` : `No conflict-free slot for "${sugg.meta.title}"`}</Text>
              <Text style={styles.rowD}>{sugg.meta.durationMin} min - {describeResources(sugg.meta.resources)}{sugg.windowLabel ? ` · ${sugg.windowLabel}` : ''}</Text>
              {sugg.suggestions.map((s, i) => (
                <View key={i} style={styles.slotRow}>
                  <View style={{ flex: 1 }}><Text style={styles.rowT}>{dayLabel(s.start)} - {clock(s.start)} to {clock(s.end)}</Text><Text style={styles.rowD}>{s.reasons.join(', ')}</Text></View>
                  <TouchableOpacity style={styles.btnSm} onPress={() => accept(s)}><Text style={styles.btnT}>Add</Text></TouchableOpacity>
                </View>
              ))}
              {/* Refine the window with a plain-language comment, e.g. "last week of this month". */}
              <View style={[styles.findRow, { marginTop: 10 }]}>
                <TextInput style={styles.input} placeholder="Not these? Tell me when… (e.g. last week of this month)" placeholderTextColor={LUCY_COLORS.textFaint} value={refineText} onChangeText={setRefineText} onSubmitEditing={() => refineSuggestion(refineText)} />
                <TouchableOpacity style={styles.btn} disabled={busy || !refineText.trim()} onPress={() => refineSuggestion(refineText)}><Text style={styles.btnT}>Redo</Text></TouchableOpacity>
              </View>
            </View>
          ) : null}

          <View style={styles.queueCard}>
            <View style={styles.boxHead}>
              <View>
                <Text style={styles.panelEyebrow}>Loose tasks</Text>
                <Text style={styles.boxH}>{unsched.length ? `${unsched.length} waiting for time` : 'Nothing waiting'}</Text>
              </View>
              <TouchableOpacity style={styles.btnSm} onPress={planDay} disabled={busy}><Text style={styles.btnT}>Plan</Text></TouchableOpacity>
            </View>
            {unsched.length === 0 && !proposals ? <Text style={styles.emptyText}>No pending tasks need a time. Lucy will surface them here when they do.</Text> : null}
            {unsched.map((t) => (
              <View key={t.id} style={styles.taskRow}>
                <Text style={[styles.rowT, { flex: 1 }]} numberOfLines={2}>{t.task}</Text>
                <TouchableOpacity style={styles.btnGhost} onPress={() => doSuggest(t.task, t.id)}><Text style={styles.btnGhostT}>Find time</Text></TouchableOpacity>
              </View>
            ))}
            {proposals ? (
              <View style={styles.proposalWrap}>
                <View style={styles.boxHead}><Text style={styles.boxH}>Proposed plan ({proposals.length})</Text>{proposals.length > 0 ? <TouchableOpacity style={styles.btnSm} onPress={acceptAll}><Text style={styles.btnT}>Add all</Text></TouchableOpacity> : null}</View>
                {proposals.length === 0 ? <Text style={styles.emptyText}>Nothing fit your free time right now.</Text> : null}
                {proposals.map((p, i) => (
                  <View key={i} style={styles.slotRow}>
                    <View style={{ flex: 1 }}><Text style={styles.rowT}>{p.title}</Text><Text style={styles.rowD}>{dayLabel(p.start)} - {clock(p.start)} to {clock(p.end)} - {p.resourceLabel}</Text></View>
                    <TouchableOpacity style={styles.btnGhost} onPress={() => acceptProposal(p)}><Text style={styles.btnGhostT}>Add</Text></TouchableOpacity>
                  </View>
                ))}
              </View>
            ) : null}
          </View>

        </>
      ) : null}
      {busy ? <View style={styles.busy}><ActivityIndicator color={LUCY_COLORS.primary} /></View> : null}

      {/* New-event card — appears when you tap an empty slot in Day view. Lucy peeks over the top edge
          and asks; the slot you tapped is prefilled, and you pick a duration before adding. */}
      <Modal visible={!!createDraft} transparent animationType="fade" onRequestClose={() => setCreateDraft(null)}>
        <Pressable style={styles.createBackdrop} onPress={() => setCreateDraft(null)}>
          {/* Outer wrapper keeps overflow visible so Lucy isn't clipped; tap inside is swallowed. */}
          <Pressable style={styles.createOuter} onPress={() => { /* swallow */ }}>
            <Animated.View
              style={{
                opacity: createAnim,
                transform: [
                  { translateY: createAnim.interpolate({ inputRange: [0, 1], outputRange: [22, 0] }) },
                  { scale: createAnim.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
                ],
              }}
            >
              <View style={styles.createCard}>
                {/* LUCY peeks over the top edge of the pop-up — this is exactly where she belongs.
                    Re-keyed per opened slot so her pop-up entrance replays each time. */}
                <LucyPeek key={`peek-create-${createDraft?.startMs ?? 0}`} />
                <Text style={styles.createEyebrow}>New event</Text>
                <Text style={styles.createPrompt}>When works for you?</Text>

                <TextInput
                  style={styles.createTitleInput}
                  value={createDraft?.title ?? ''}
                  onChangeText={(t) => setCreateDraft((d) => (d ? { ...d, title: t } : d))}
                  placeholder="What's the event?"
                  placeholderTextColor={LUCY_COLORS.textFaint}
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={addCreatedEvent}
                />

                <Text style={styles.createSection}>Starts</Text>
                <View style={styles.createStartRow}>
                  <TouchableOpacity style={styles.stepBtn} activeOpacity={0.7} onPress={() => nudgeDraft(-15)} hitSlop={8}>
                    <Text style={styles.stepBtnT}>−15m</Text>
                  </TouchableOpacity>
                  <View style={styles.startDisplay}>
                    <Text style={styles.startDay}>{createDraft ? dayLabel(createDraft.startMs) : ''}</Text>
                    <Text style={styles.startTime}>{createDraft ? clock(createDraft.startMs) : ''}</Text>
                  </View>
                  <TouchableOpacity style={styles.stepBtn} activeOpacity={0.7} onPress={() => nudgeDraft(15)} hitSlop={8}>
                    <Text style={styles.stepBtnT}>+15m</Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.createSection}>How long?</Text>
                <View style={styles.eventChipRow}>
                  {[30, 60, 90, 120].map((m) => {
                    const on = createDraft?.durationMin === m;
                    return (
                      <TouchableOpacity
                        key={m}
                        style={[styles.durChip, on && styles.durChipOn]}
                        activeOpacity={0.8}
                        onPress={() => setCreateDraft((d) => (d ? { ...d, durationMin: m } : d))}
                      >
                        <Text style={[styles.durChipT, on && styles.durChipTOn]}>{m < 60 ? `${m} min` : m === 60 ? '1 hr' : `${m / 60} hr`}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <Text style={styles.createEndHint}>
                  {createDraft ? `Ends ${clock(createDraft.startMs + createDraft.durationMin * 60000)}` : ''}
                </Text>

                <View style={styles.eventActions}>
                  <TouchableOpacity style={styles.sheetSecondary} activeOpacity={0.7} onPress={() => setCreateDraft(null)}>
                    <Text style={styles.sheetSecondaryT}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.eventDone} activeOpacity={0.85} onPress={addCreatedEvent} disabled={busy}>
                    <Text style={styles.eventDoneT}>Add to calendar</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </Animated.View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Event detail card — rename / recurring / reschedule / delete */}
      <Modal visible={!!detail} transparent animationType="slide" onRequestClose={() => setDetail(null)}>
        <Pressable style={styles.cardBackdrop} onPress={() => setDetail(null)}>
          <Pressable style={styles.eventCard} onPress={() => { /* swallow */ }}>
            {(() => {
              const accent = detail ? catColor(detail.title, describeResources(detail.resources)) : LUCY_COLORS.primary;
              return (
                <>
                  <View style={styles.cardGrip} />
                  <View style={[styles.accentHalo, { backgroundColor: `${accent}1A` }]} pointerEvents="none" />
                  <View style={styles.sheetHeader}>
                    <View style={[styles.sheetRail, { backgroundColor: accent }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.sheetEyebrow}>{detail ? dayLabel(detail.start).toUpperCase() : 'EVENT'}</Text>
                      <Text style={styles.sheetWhenRow}>{detail ? `${clock(detail.start)} – ${clock(detail.end)}` : ''}</Text>
                    </View>
                    <View style={[styles.sheetTag, { backgroundColor: `${accent}22`, borderColor: `${accent}55` }]}>
                      <View style={[styles.sheetTagDot, { backgroundColor: accent }]} />
                      <Text style={[styles.sheetTagT, { color: accent }]}>{detail ? describeResources(detail.resources) : 'Lucy'}</Text>
                    </View>
                  </View>

                  <View style={styles.eventTitleWrap}>
                    <TextInput style={styles.eventTitleInput} value={nameEdit} onChangeText={setNameEdit} placeholder="Event name" placeholderTextColor={LUCY_COLORS.textFaint} />
                    {detail && nameEdit.trim() && nameEdit.trim() !== detail.title ? (
                      <TouchableOpacity style={styles.eventSave} onPress={saveName}><Text style={styles.eventSaveT}>Save</Text></TouchableOpacity>
                    ) : null}
                  </View>

                  <Text style={styles.eventSection}>Repeat</Text>
                  <View style={styles.eventChipRow}>
                    {(['daily', 'weekdays', 'weekly'] as const).map((r) => (
                      <TouchableOpacity key={r} style={styles.eventChip} activeOpacity={0.7} onPress={() => makeRecurring(r)}>
                        <Text style={styles.eventChipT}>{r === 'weekdays' ? 'Weekdays' : r[0].toUpperCase() + r.slice(1)}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <Text style={styles.eventSection}>Reschedule</Text>
                  <View style={styles.eventChipRow}>
                    <TouchableOpacity style={styles.eventChip} activeOpacity={0.7} onPress={() => shiftEvent(-3600_000)}><Text style={styles.eventChipT}>−1h</Text></TouchableOpacity>
                    <TouchableOpacity style={styles.eventChip} activeOpacity={0.7} onPress={() => shiftEvent(-900_000)}><Text style={styles.eventChipT}>−15m</Text></TouchableOpacity>
                    <TouchableOpacity style={styles.eventChip} activeOpacity={0.7} onPress={() => shiftEvent(900_000)}><Text style={styles.eventChipT}>+15m</Text></TouchableOpacity>
                    <TouchableOpacity style={styles.eventChip} activeOpacity={0.7} onPress={() => shiftEvent(3600_000)}><Text style={styles.eventChipT}>+1h</Text></TouchableOpacity>
                  </View>
                  <View style={styles.eventChipRow}>
                    <TouchableOpacity style={styles.eventChip} activeOpacity={0.7} onPress={() => shiftEvent(86400_000)}><Text style={styles.eventChipT}>+1 day</Text></TouchableOpacity>
                    <TouchableOpacity style={styles.eventChip} activeOpacity={0.7} onPress={() => shiftEvent(7 * 86400_000)}><Text style={styles.eventChipT}>+1 week</Text></TouchableOpacity>
                  </View>

                  <View style={styles.eventActions}>
                    <TouchableOpacity style={styles.eventDelete} activeOpacity={0.7} onPress={deleteEvent}><Text style={styles.eventDeleteT}>Delete</Text></TouchableOpacity>
                    <TouchableOpacity style={styles.eventDone} activeOpacity={0.85} onPress={() => setDetail(null)}><Text style={styles.eventDoneT}>Done</Text></TouchableOpacity>
                  </View>
                </>
              );
            })()}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Habit suggestion — designed sheet (was a plain OS alert) */}
      <Modal visible={!!habitSuggest} transparent animationType="slide" onRequestClose={() => setHabitSuggest(null)}>
        <Pressable style={styles.cardBackdrop} onPress={() => setHabitSuggest(null)}>
          <Pressable style={styles.eventCard} onPress={() => { /* swallow */ }}>
            {(() => {
              const accent = habitSuggest ? catColor(habitSuggest.title, describeResources(habitSuggest.resources)) : LUCY_COLORS.primary;
              return (
                <>
                  <View style={styles.cardGrip} />
                  <View style={[styles.accentHalo, { backgroundColor: `${accent}1A` }]} pointerEvents="none" />
                  <View style={styles.sheetHeader}>
                    <View style={[styles.sheetIcon, { backgroundColor: `${accent}22`, borderColor: `${accent}55` }]}>
                      <Text style={[styles.sheetIconText, { color: accent }]}>✦</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.sheetEyebrow}>Suggested from your routine</Text>
                      <Text style={styles.sheetTitle} numberOfLines={2}>{habitSuggest?.title ?? ''}</Text>
                    </View>
                  </View>
                  <View style={styles.sheetWhenChip}>
                    <View style={[styles.sheetTagDot, { backgroundColor: accent }]} />
                    <Text style={styles.sheetWhen}>{habitSuggest ? `${clock(habitSuggest.start)} – ${clock(habitSuggest.end)}` : ''}</Text>
                  </View>
                  <Text style={styles.sheetBody}>Add this to today's schedule? It stays just a gentle nudge until you do — nothing takes up your time yet.</Text>
                  <Text style={styles.eventSection}>Prefer another time?</Text>
                  <View style={styles.eventChipRow}>
                    <TouchableOpacity style={styles.eventChip} activeOpacity={0.7} onPress={() => setHabitSuggest((h) => h ? { ...h, start: h.start - 3600_000, end: h.end - 3600_000 } : h)}><Text style={styles.eventChipT}>−1h</Text></TouchableOpacity>
                    <TouchableOpacity style={styles.eventChip} activeOpacity={0.7} onPress={() => setHabitSuggest((h) => h ? { ...h, start: h.start - 1800_000, end: h.end - 1800_000 } : h)}><Text style={styles.eventChipT}>−30m</Text></TouchableOpacity>
                    <TouchableOpacity style={styles.eventChip} activeOpacity={0.7} onPress={() => setHabitSuggest((h) => h ? { ...h, start: h.start + 1800_000, end: h.end + 1800_000 } : h)}><Text style={styles.eventChipT}>+30m</Text></TouchableOpacity>
                    <TouchableOpacity style={styles.eventChip} activeOpacity={0.7} onPress={() => setHabitSuggest((h) => h ? { ...h, start: h.start + 3600_000, end: h.end + 3600_000 } : h)}><Text style={styles.eventChipT}>+1h</Text></TouchableOpacity>
                  </View>
                  <View style={styles.eventActions}>
                    <TouchableOpacity style={styles.sheetSecondary} activeOpacity={0.7} onPress={() => setHabitSuggest(null)}><Text style={styles.sheetSecondaryT}>Not now</Text></TouchableOpacity>
                    <TouchableOpacity style={styles.eventDone} activeOpacity={0.85} onPress={() => { const h = habitSuggest; setHabitSuggest(null); if (h) void approveHabit(h); }}><Text style={styles.eventDoneT}>Add at {habitSuggest ? clock(habitSuggest.start) : ''}</Text></TouchableOpacity>
                  </View>
                </>
              );
            })()}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Conflict resolution — pick which event to move out of the overlap */}
      <Modal visible={!!resolve} transparent animationType="slide" onRequestClose={() => setResolve(null)}>
        <Pressable style={styles.cardBackdrop} onPress={() => setResolve(null)}>
          <Pressable style={styles.eventCard} onPress={() => { /* swallow */ }}>
            <View style={styles.cardGrip} />
            <View style={[styles.accentHalo, { backgroundColor: `${LUCY_COLORS.error}1A` }]} pointerEvents="none" />
            <View style={styles.sheetHeader}>
              <View style={[styles.sheetIcon, { backgroundColor: `${LUCY_COLORS.error}22`, borderColor: `${LUCY_COLORS.error}55` }]}>
                <Text style={[styles.sheetIconText, { color: LUCY_COLORS.error }]}>⇄</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.sheetEyebrow, { color: LUCY_COLORS.error }]}>Two things overlap</Text>
                <Text style={styles.sheetTitle}>Resolve overlap</Text>
              </View>
            </View>
            {resolve ? (
              <View style={styles.overlapPair}>
                <View style={styles.overlapRow}>
                  <View style={[styles.sheetTagDot, { backgroundColor: catColor(resolve.a.title, describeResources(resolve.a.resources)) }]} />
                  <Text style={styles.overlapName} numberOfLines={1}>{resolve.a.title}</Text>
                  <Text style={styles.overlapTime}>{clock(resolve.a.start)}–{clock(resolve.a.end)}</Text>
                </View>
                <View style={styles.overlapRow}>
                  <View style={[styles.sheetTagDot, { backgroundColor: catColor(resolve.b.title, describeResources(resolve.b.resources)) }]} />
                  <Text style={styles.overlapName} numberOfLines={1}>{resolve.b.title}</Text>
                  <Text style={styles.overlapTime}>{clock(resolve.b.start)}–{clock(resolve.b.end)}</Text>
                </View>
              </View>
            ) : null}
            <Text style={styles.sheetBody}>Pick a new time for one of them and the overlap clears.</Text>
            {resolve ? <MoveOptions x={resolve.a} o={resolve.b} sugg={resolveSugg.a} /> : null}
            {resolve ? <MoveOptions x={resolve.b} o={resolve.a} sugg={resolveSugg.b} /> : null}
            {resolve && !resolve.a.id && !resolve.b.id ? (
              <Text style={styles.emptyText}>Both events come from a connected calendar — change them in that calendar app.</Text>
            ) : null}
            <View style={styles.eventActions}>
              <TouchableOpacity style={styles.sheetSecondaryFull} activeOpacity={0.7} onPress={() => setResolve(null)}><Text style={styles.sheetSecondaryT}>Close</Text></TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
      <ActionSheet
        visible={!!infoSheet}
        onClose={() => setInfoSheet(null)}
        context={infoSheet?.context}
        title={infoSheet?.title ?? ''}
        message={infoSheet?.message}
        accent={infoSheet?.accent}
        actions={infoSheet?.actions ?? []}
        cancelLabel={infoSheet?.cancelLabel === undefined ? 'Cancel' : infoSheet.cancelLabel}
      />
      <Toast visible={!!calToast} message={calToast ?? ''} onHide={() => setCalToast(null)} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  wrap: { padding: 14, paddingBottom: 76 },
  hero: { backgroundColor: LUCY_COLORS.surface, borderWidth: 1, borderColor: LUCY_COLORS.primaryLine, borderRadius: 26, padding: 18, marginBottom: 12, shadowColor: LUCY_COLORS.primary, shadowOpacity: 0.10, shadowRadius: 18, elevation: 4 },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  kicker: { color: LUCY_COLORS.primaryGlow, fontSize: 11, fontWeight: '900', letterSpacing: 1.1, textTransform: 'uppercase' },
  heroMeta: { color: LUCY_COLORS.textMuted, fontSize: 11, fontWeight: '800', backgroundColor: LUCY_COLORS.surfaceRaised, borderWidth: 1, borderColor: LUCY_COLORS.border, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6, overflow: 'hidden' },
  heroTitle: { color: LUCY_COLORS.textDark, fontSize: 25, fontWeight: '900', lineHeight: 31 },
  heroSub: { color: LUCY_COLORS.textMuted, fontSize: 13.5, lineHeight: 20, marginTop: 7 },
  heroStats: { flexDirection: 'row', gap: 8, marginTop: 16 },
  heroStat: { flex: 1, backgroundColor: LUCY_COLORS.surfaceRaised, borderWidth: 1, borderColor: LUCY_COLORS.border, borderRadius: 16, padding: 11 },
  heroStatN: { color: LUCY_COLORS.textDark, fontSize: 22, fontWeight: '900' },
  heroStatL: { color: LUCY_COLORS.textSubtle, fontSize: 10.5, fontWeight: '800' },
  heroPlan: { marginTop: 14, backgroundColor: LUCY_COLORS.primary, borderRadius: 16, paddingVertical: 13, alignItems: 'center' },
  heroPlanText: { color: LUCY_COLORS.white, fontSize: 15, fontWeight: '900' },
  avLine: { color: LUCY_COLORS.textMuted, fontSize: 12, marginBottom: 12, paddingHorizontal: 5 },
  headRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 12, paddingHorizontal: 2 },
  headTitle: { color: LUCY_COLORS.textDark, fontSize: 20, fontWeight: '900', marginTop: 3, lineHeight: 25 },
  headSub: { color: LUCY_COLORS.textMuted, fontSize: 12.5, marginTop: 3 },
  navGroup: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  weekStrip: { flexDirection: 'row', marginBottom: 14, backgroundColor: LUCY_COLORS.surfaceRaised, borderWidth: 1, borderColor: LUCY_COLORS.borderSoft, borderRadius: 16, paddingVertical: 8, paddingHorizontal: 2 },
  wsDay: { flex: 1, alignItems: 'center', gap: 5, paddingVertical: 2 },
  wsDow: { color: LUCY_COLORS.textSubtle, fontSize: 10, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' },
  wsDowSel: { color: LUCY_COLORS.primaryGlow },
  wsNum: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  wsNumToday: { backgroundColor: LUCY_COLORS.primary, shadowColor: LUCY_COLORS.primary, shadowOpacity: 0.45, shadowRadius: 8, shadowOffset: { width: 0, height: 0 }, elevation: 4 },
  wsNumSel: { borderWidth: 1.5, borderColor: LUCY_COLORS.primaryLine, backgroundColor: LUCY_COLORS.primaryMist },
  wsNumT: { color: LUCY_COLORS.textMuted, fontSize: 14, fontWeight: '800' },
  wsNumTOn: { color: '#fff' },
  wsDots: { flexDirection: 'row', gap: 3, height: 5, alignItems: 'center' },
  wsDot: { width: 4, height: 4, borderRadius: 2 },
  planToggle: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: LUCY_COLORS.surface, borderWidth: 1, borderColor: LUCY_COLORS.border, borderRadius: 18, padding: 15, marginTop: 12 },
  planToggleT: { color: LUCY_COLORS.textDark, fontSize: 15, fontWeight: '900' },
  planToggleSub: { color: LUCY_COLORS.textMuted, fontSize: 12.5, marginTop: 2 },
  planBadge: { backgroundColor: LUCY_COLORS.primary, borderRadius: 999, minWidth: 22, height: 22, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  planBadgeT: { color: '#fff', fontSize: 12, fontWeight: '900' },
  planChevron: { color: LUCY_COLORS.textMuted, fontSize: 16, fontWeight: '900' },
  connectCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: LUCY_COLORS.surface, borderWidth: 1, borderColor: '#5B8CFF55', borderRadius: 18, padding: 14, marginBottom: 12 },
  connectIcon: { fontSize: 22 },
  connectTitle: { color: LUCY_COLORS.textDark, fontWeight: '900', fontSize: 14.5 },
  connectSub: { color: LUCY_COLORS.textMuted, fontSize: 12.5, lineHeight: 17, marginTop: 3 },
  connectChevron: { color: '#5B8CFF', fontSize: 26, fontWeight: '300' },
  syncedPill: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 12, paddingHorizontal: 5 },
  syncedDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#5B8CFF' },
  syncedText: { color: LUCY_COLORS.textMuted, fontSize: 12, fontWeight: '700' },
  nowLine: { position: 'absolute', left: 0, right: 0, height: 1.5, backgroundColor: '#FF4D4D', opacity: 0.92 },
  nowDot: { position: 'absolute', left: -4, top: -3.5, width: 9, height: 9, borderRadius: 5, backgroundColor: '#FF4D4D', borderWidth: 2, borderColor: LUCY_COLORS.surfaceRaised, shadowColor: '#FF4D4D', shadowOpacity: 0.6, shadowRadius: 4, shadowOffset: { width: 0, height: 0 } },
  plannerCard: { backgroundColor: LUCY_COLORS.surfaceRaised, borderWidth: 1, borderColor: LUCY_COLORS.border, borderRadius: 22, padding: 16, marginBottom: 12 },
  panelEyebrow: { color: LUCY_COLORS.primaryGlow, fontSize: 10.5, fontWeight: '900', letterSpacing: 1, textTransform: 'uppercase' },
  panelTitle: { color: LUCY_COLORS.textDark, fontSize: 18, fontWeight: '900', marginTop: 4, marginBottom: 12 },
  findRow: { flexDirection: 'row', gap: 8 },
  input: { flex: 1, backgroundColor: LUCY_COLORS.background, borderWidth: 1, borderColor: LUCY_COLORS.border, borderRadius: 15, paddingHorizontal: 13, paddingVertical: 12, color: LUCY_COLORS.textDark },
  btn: { backgroundColor: LUCY_COLORS.primary, borderRadius: 15, paddingHorizontal: 16, justifyContent: 'center' },
  btnSm: { backgroundColor: LUCY_COLORS.primary, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 9, justifyContent: 'center' },
  btnT: { color: '#fff', fontWeight: '800', fontSize: 13 },
  btnGhost: { borderWidth: 1, borderColor: LUCY_COLORS.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: LUCY_COLORS.surface },
  btnGhostT: { color: LUCY_COLORS.textDark, fontSize: 13, fontWeight: '700' },
  resultCard: { backgroundColor: LUCY_COLORS.surfaceRaised, borderWidth: 1, borderColor: LUCY_COLORS.border, borderRadius: 20, padding: 15, marginBottom: 12 },
  queueCard: { backgroundColor: LUCY_COLORS.surface, borderWidth: 1, borderColor: LUCY_COLORS.border, borderRadius: 22, padding: 16, marginBottom: 12 },
  boxHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  boxH: { color: LUCY_COLORS.textDark, fontWeight: '900', fontSize: 15 },
  rowT: { color: LUCY_COLORS.textDark, fontWeight: '700', fontSize: 14, lineHeight: 19 },
  rowD: { color: LUCY_COLORS.textMuted, fontSize: 12, marginTop: 3, lineHeight: 17 },
  emptyText: { color: LUCY_COLORS.textMuted, fontSize: 13, lineHeight: 19, marginTop: 10 },
  emptyState: { alignItems: 'center', paddingVertical: 34, paddingHorizontal: 18 },
  emptyEmoji: { fontSize: 34, marginBottom: 12, opacity: 0.9 },
  emptyTitle: { color: LUCY_COLORS.textDark, fontSize: 16, fontWeight: '900', textAlign: 'center' },
  emptyBody: { color: LUCY_COLORS.textMuted, fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 6, maxWidth: 300 },
  taskRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: LUCY_COLORS.border },
  slotRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, backgroundColor: LUCY_COLORS.surface, borderRadius: 15, borderWidth: 1, borderColor: LUCY_COLORS.border, padding: 12 },
  proposalWrap: { marginTop: 12 },
  conflictCard: { borderColor: LUCY_COLORS.error },
  conflictRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 9 },
  timetableCard: { backgroundColor: LUCY_COLORS.surface, borderWidth: 1, borderColor: LUCY_COLORS.border, borderRadius: 24, padding: 16, shadowColor: LUCY_COLORS.primary, shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  timetableHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 14 },
  section: { color: LUCY_COLORS.textDark, fontWeight: '900', fontSize: 20, marginTop: 3 },
  rangeL: { color: LUCY_COLORS.textDark, fontSize: 15.5, fontWeight: '900', flexShrink: 1, letterSpacing: 0.2 },
  viewRow: { marginBottom: 14 },
  viewChip: { flex: 1, alignItems: 'center', paddingHorizontal: 8, paddingVertical: 8, borderRadius: 999 },
  viewChipOn: { backgroundColor: LUCY_COLORS.primary, shadowColor: LUCY_COLORS.primary, shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 0 }, elevation: 3 },
  viewChipT: { color: LUCY_COLORS.textMuted, fontSize: 12.5, fontWeight: '800' },
  viewChipTOn: { color: '#fff' },
  navBtn: { minWidth: 38, alignItems: 'center', paddingHorizontal: 11, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: LUCY_COLORS.border, backgroundColor: LUCY_COLORS.surfaceRaised },
  navT: { color: LUCY_COLORS.textDark, fontSize: 13, fontWeight: '800' },
  agendaDay: { marginBottom: 18 },
  dayH: { color: LUCY_COLORS.primaryGlow, fontWeight: '900', marginBottom: 10, fontSize: 11.5, letterSpacing: 1, textTransform: 'uppercase' },
  block: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: LUCY_COLORS.surfaceRaised, borderWidth: 1, borderColor: LUCY_COLORS.border, borderLeftWidth: 3, borderRadius: 16, paddingVertical: 13, paddingHorizontal: 14, marginBottom: 8 },
  blockConflict: { borderColor: `${LUCY_COLORS.error}88`, borderLeftColor: LUCY_COLORS.error },
  blockHabit: { opacity: 0.72, borderStyle: 'dashed', backgroundColor: LUCY_COLORS.surface },
  blockTimeWrap: { width: 64 },
  blockTime: { color: LUCY_COLORS.textDark, fontSize: 13.5, fontWeight: '900' },
  blockTimeEnd: { color: LUCY_COLORS.textSubtle, fontSize: 11, fontWeight: '700', marginTop: 2 },
  blockT: { color: LUCY_COLORS.textDark, fontWeight: '800', fontSize: 14.5, lineHeight: 20 },
  x: { color: LUCY_COLORS.textSubtle, fontSize: 12, fontWeight: '800', paddingHorizontal: 4 },
  approveBtn: { backgroundColor: LUCY_COLORS.primaryMist, borderWidth: 1, borderColor: LUCY_COLORS.primary, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  approveT: { color: LUCY_COLORS.primary, fontSize: 13, fontWeight: '900' },
  gridWrap: { flexDirection: 'row', borderWidth: 1, borderColor: LUCY_COLORS.borderSoft, borderRadius: 18, paddingTop: 12, paddingBottom: 12, paddingRight: 10, backgroundColor: LUCY_COLORS.background },
  weekScroll: { borderWidth: 1, borderColor: LUCY_COLORS.borderSoft, borderRadius: 18, backgroundColor: LUCY_COLORS.background },
  weekContent: { paddingTop: 8, paddingBottom: 12, paddingRight: 10 },
  weekDay: { width: 116 },
  weekDayText: { textAlign: 'center', fontSize: 11, fontWeight: '800', color: LUCY_COLORS.textSubtle, marginBottom: 8, letterSpacing: 0.3 },
  weekDayTextToday: { color: LUCY_COLORS.primary },
  dayCol: { position: 'relative', borderLeftWidth: 1, borderLeftColor: LUCY_COLORS.borderSoft },
  hourLabels: { width: 42, position: 'relative' },
  hourLabel: { position: 'absolute', right: 8, fontSize: 9.5, fontWeight: '700', letterSpacing: 0.3, color: LUCY_COLORS.textFaint },
  hourLabelNow: { color: '#FF4D4D', fontWeight: '900' },
  hourLine: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: LUCY_COLORS.border, opacity: 0.5 },
  gridEvent: { position: 'absolute', left: 4, right: 4, borderWidth: StyleSheet.hairlineWidth, borderLeftWidth: 3, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 4, overflow: 'hidden' },
  gridHabit: { opacity: 0.7, borderStyle: 'dashed' },
  gridEventTitle: { color: LUCY_COLORS.textDark, fontSize: 11, fontWeight: '800', lineHeight: 14 },
  gridEventTime: { color: LUCY_COLORS.textMuted, fontSize: 9.5, fontWeight: '700', marginTop: 1 },
  monthWrap: { gap: 8 },
  monthDays: { flexDirection: 'row', marginBottom: 2 },
  monthDayText: { flex: 1, textAlign: 'center', color: LUCY_COLORS.textSubtle, fontSize: 10.5, fontWeight: '800', letterSpacing: 0.5 },
  monthGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  monthCellBlank: { width: `${100 / 7}%`, aspectRatio: 1 },
  monthCellOuter: { width: `${100 / 7}%`, aspectRatio: 1, padding: 3 },
  monthCell: { flex: 1, borderWidth: 1, borderColor: LUCY_COLORS.borderSoft, borderRadius: 12, paddingTop: 6, alignItems: 'center', backgroundColor: LUCY_COLORS.surfaceRaised },
  monthCellToday: { borderColor: LUCY_COLORS.primaryLine, backgroundColor: LUCY_COLORS.primaryMist },
  monthCellDate: { fontSize: 12.5, fontWeight: '700', color: LUCY_COLORS.textMuted },
  monthCellDateToday: { color: LUCY_COLORS.primaryGlow, fontWeight: '900' },
  monthCellCount: { marginTop: 4, backgroundColor: LUCY_COLORS.primary, borderRadius: 999, minWidth: 18, textAlign: 'center', paddingHorizontal: 5, paddingVertical: 1, color: '#fff', fontSize: 10, fontWeight: '900', overflow: 'hidden' },
  busy: { paddingVertical: 16 },
  cardBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.62)', justifyContent: 'flex-end' },
  // ── Shared sheet family (event detail · habit suggestion · overlap resolver) ──
  eventCard: {
    backgroundColor: LUCY_COLORS.surfaceSheet, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 22, paddingTop: 12, paddingBottom: 30,
    borderWidth: 1, borderColor: LUCY_COLORS.border, overflow: 'hidden',
    shadowColor: LUCY_COLORS.primary, shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.18, shadowRadius: 24, elevation: 16,
  },
  cardGrip: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: LUCY_COLORS.textFaint, opacity: 0.7, marginBottom: 16 },
  // Soft accent halo bleeding from the top — gives each sheet its category-colored glow.
  accentHalo: { position: 'absolute', top: -120, left: -40, right: -40, height: 240, borderRadius: 240 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 13, marginBottom: 14 },
  sheetRail: { width: 4, borderRadius: 2, alignSelf: 'stretch', minHeight: 38 },
  sheetIcon: { width: 46, height: 46, borderRadius: 23, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  sheetIconText: { fontSize: 20, fontWeight: '900', color: LUCY_COLORS.primary },
  sheetEyebrow: { color: LUCY_COLORS.primaryGlow, fontSize: 10.5, fontWeight: '900', letterSpacing: 1.1, textTransform: 'uppercase' },
  sheetTitle: { color: LUCY_COLORS.textDark, fontSize: 21, fontWeight: '900', lineHeight: 26, marginTop: 3 },
  sheetWhenRow: { color: LUCY_COLORS.textDark, fontSize: 16, fontWeight: '900', marginTop: 3 },
  sheetTag: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6, maxWidth: 130 },
  sheetTagDot: { width: 7, height: 7, borderRadius: 4 },
  sheetTagT: { fontSize: 11.5, fontWeight: '800' },
  sheetWhenChip: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', backgroundColor: LUCY_COLORS.surfaceRaised, borderWidth: 1, borderColor: LUCY_COLORS.border, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 8, marginBottom: 12 },
  sheetWhen: { color: LUCY_COLORS.textDark, fontSize: 13.5, fontWeight: '800' },
  sheetBody: { color: LUCY_COLORS.textMuted, fontSize: 13.5, lineHeight: 20, marginBottom: 4 },
  // Event title with inline Save
  eventTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: LUCY_COLORS.surfaceRaised, borderWidth: 1, borderColor: LUCY_COLORS.border, borderRadius: 16, paddingLeft: 16, paddingRight: 8, paddingVertical: 4 },
  eventTitleInput: { flex: 1, color: LUCY_COLORS.textDark, fontSize: 19, fontWeight: '900', paddingVertical: 10 },
  eventSave: { backgroundColor: LUCY_COLORS.primary, borderRadius: 11, paddingHorizontal: 16, paddingVertical: 10 },
  eventSaveT: { color: '#fff', fontWeight: '900', fontSize: 13 },
  eventSection: { color: LUCY_COLORS.textSubtle, fontSize: 10.5, fontWeight: '900', letterSpacing: 1.1, textTransform: 'uppercase', marginTop: 22, marginBottom: 10 },
  eventChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  eventChip: { minHeight: 44, justifyContent: 'center', backgroundColor: LUCY_COLORS.surfaceRaised, borderWidth: 1, borderColor: LUCY_COLORS.border, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 11 },
  eventChipT: { color: LUCY_COLORS.textDark, fontSize: 13.5, fontWeight: '800' },
  // Best-time chips (resolver) — amber-tinted to read as Lucy's recommendation
  moveGroup: { marginTop: 18 },
  moveHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  moveHeadT: { flex: 1, color: LUCY_COLORS.textDark, fontSize: 14, fontWeight: '900' },
  moveLoadRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 10 },
  moveLoadT: { color: LUCY_COLORS.textMuted, fontSize: 12.5, fontWeight: '700' },
  moveChipBest: { minHeight: 44, justifyContent: 'center', backgroundColor: LUCY_COLORS.primaryMist, borderWidth: 1, borderColor: LUCY_COLORS.primaryLine, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 11 },
  moveChipBestT: { color: LUCY_COLORS.primaryGlow, fontSize: 13.5, fontWeight: '900' },
  // Overlap summary pair
  overlapPair: { backgroundColor: LUCY_COLORS.surfaceRaised, borderWidth: 1, borderColor: LUCY_COLORS.border, borderRadius: 16, padding: 14, gap: 11, marginBottom: 14 },
  overlapRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  overlapName: { flex: 1, color: LUCY_COLORS.textDark, fontSize: 14, fontWeight: '800' },
  overlapTime: { color: LUCY_COLORS.textMuted, fontSize: 12.5, fontWeight: '700' },
  // Footer actions
  eventActions: { flexDirection: 'row', gap: 10, marginTop: 26 },
  eventDelete: { flex: 1, minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: 15, borderWidth: 1, borderColor: `${LUCY_COLORS.error}77`, backgroundColor: `${LUCY_COLORS.error}14` },
  eventDeleteT: { color: LUCY_COLORS.error, fontWeight: '900', fontSize: 14.5 },
  eventDone: { flex: 1.4, minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: 15, backgroundColor: LUCY_COLORS.primary, shadowColor: LUCY_COLORS.primary, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.35, shadowRadius: 12, elevation: 6 },
  eventDoneT: { color: '#fff', fontWeight: '900', fontSize: 14.5 },
  sheetSecondary: { flex: 1, minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: 15, borderWidth: 1, borderColor: LUCY_COLORS.border, backgroundColor: LUCY_COLORS.surfaceRaised },
  sheetSecondaryFull: { flex: 1, minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: 15, borderWidth: 1, borderColor: LUCY_COLORS.border, backgroundColor: LUCY_COLORS.surfaceRaised },
  sheetSecondaryT: { color: LUCY_COLORS.textMuted, fontWeight: '800', fontSize: 14.5 },

  // ── Tap-to-create: hint + Lucy-peeking "new event" card ──────────────────────
  gridHint: { color: LUCY_COLORS.textSubtle, fontSize: 11.5, fontWeight: '700', textAlign: 'center', marginTop: 10, letterSpacing: 0.2 },
  // Centered (not a bottom sheet) so Lucy can peek over the top edge; dimmed, tap-to-dismiss backdrop.
  createBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.62)', alignItems: 'center', justifyContent: 'center', padding: 22 },
  // Outer wrapper keeps overflow visible (Lucy hangs above the card) + reserves headroom for her.
  createOuter: { width: '100%', maxWidth: 420, paddingTop: 34, overflow: 'visible' },
  createCard: {
    backgroundColor: LUCY_COLORS.surfaceSheet, borderRadius: 28, paddingHorizontal: 22, paddingTop: 16, paddingBottom: 22,
    borderWidth: 1, borderColor: LUCY_COLORS.border, overflow: 'visible',
    shadowColor: LUCY_COLORS.primary, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.22, shadowRadius: 28, elevation: 18,
  },
  createEyebrow: { color: LUCY_COLORS.primaryGlow, fontSize: 10.5, fontWeight: '900', letterSpacing: 1.1, textTransform: 'uppercase' },
  createPrompt: { color: LUCY_COLORS.textDark, fontSize: 21, fontWeight: '900', lineHeight: 26, marginTop: 4, marginBottom: 16 },
  createTitleInput: { backgroundColor: LUCY_COLORS.surfaceRaised, borderWidth: 1, borderColor: LUCY_COLORS.border, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, color: LUCY_COLORS.textDark, fontSize: 17, fontWeight: '800' },
  createSection: { color: LUCY_COLORS.textSubtle, fontSize: 10.5, fontWeight: '900', letterSpacing: 1.1, textTransform: 'uppercase', marginTop: 20, marginBottom: 10 },
  createStartRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepBtn: { minHeight: 44, minWidth: 60, alignItems: 'center', justifyContent: 'center', backgroundColor: LUCY_COLORS.surfaceRaised, borderWidth: 1, borderColor: LUCY_COLORS.border, borderRadius: 14, paddingHorizontal: 12 },
  stepBtnT: { color: LUCY_COLORS.textDark, fontSize: 13.5, fontWeight: '900' },
  startDisplay: { flex: 1, alignItems: 'center', backgroundColor: LUCY_COLORS.primaryMist, borderWidth: 1, borderColor: LUCY_COLORS.primaryLine, borderRadius: 14, paddingVertical: 9 },
  startDay: { color: LUCY_COLORS.primaryGlow, fontSize: 10.5, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase' },
  startTime: { color: LUCY_COLORS.textDark, fontSize: 19, fontWeight: '900', marginTop: 2 },
  durChip: { minHeight: 44, justifyContent: 'center', backgroundColor: LUCY_COLORS.surfaceRaised, borderWidth: 1, borderColor: LUCY_COLORS.border, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 11 },
  durChipOn: { backgroundColor: LUCY_COLORS.primaryMist, borderColor: LUCY_COLORS.primary },
  durChipT: { color: LUCY_COLORS.textMuted, fontSize: 13.5, fontWeight: '800' },
  durChipTOn: { color: LUCY_COLORS.primaryGlow, fontWeight: '900' },
  createEndHint: { color: LUCY_COLORS.textSubtle, fontSize: 12, fontWeight: '700', marginTop: 10 },
});
