/**
 * ScheduleTab - Lucy's on-device calendar surface.
 * Visual redesign only: keeps the same scheduling engine calls and data shapes.
 */
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { LUCY_COLORS } from '../config/colors';
import { getDatabase } from '../db';
import {
  getPlan, suggestForText, suggestForTodo, commitBlock, cancelBlock, autoPlanDay,
  unscheduledPendingTodos, describeResources, type DayProposal,
} from '../scheduling';
import { getAvailability } from '../scheduling/availability';
import { hasCalendarPermission, requestCalendarPermission } from '../processing/calendarConnector';
import type { AvailabilityProfile, Block, SlotSuggestion, TaskResources } from '../scheduling/types';

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

interface Sugg {
  meta: { title: string; durationMin: number; resources: TaskResources; energy: string; location?: string | null };
  suggestions: SlotSuggestion[];
  todoId?: number | null;
}

export function ScheduleTab() {
  const [loading, setLoading] = useState(true);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [conflicts, setConflicts] = useState<Array<{ a: string; b: string }>>([]);
  const [av, setAv] = useState<AvailabilityProfile | null>(null);
  const [unsched, setUnsched] = useState<Array<{ id: number; task: string }>>([]);
  const [task, setTask] = useState('');
  const [sugg, setSugg] = useState<Sugg | null>(null);
  const [proposals, setProposals] = useState<DayProposal[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<'agenda' | 'day' | 'week' | 'month'>('day');
  const [ref, setRef] = useState<number>(dayKey(Date.now()));
  const [calPerm, setCalPerm] = useState<boolean | null>(null);
  const [nowMs, setNowMs] = useState<number>(Date.now());
  const [planOpen, setPlanOpen] = useState(false); // "Plan with Lucy" collapsible (calendar-first)

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
    setConflicts(plan.conflicts.map((c) => ({ a: c.a.title, b: c.b.title })));
    setAv(a);
    setUnsched(us.slice(0, 12));
    setCalPerm(perm);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  // Keep the "now" line live (updates every minute) for the day/week grid.
  useEffect(() => { const t = setInterval(() => setNowMs(Date.now()), 60_000); return () => clearInterval(t); }, []);

  const connectCalendars = async () => {
    const granted = await requestCalendarPermission();
    setCalPerm(granted);
    if (granted) { await load(); }
    else {
      Alert.alert(
        'Connect Google / Teams / Outlook',
        'To show those events here, add the account to your phone first:\n\niPhone: Settings → Calendar → Accounts → Add Account (Google or Outlook), then turn Calendars ON.\nAndroid: Settings → Accounts → add Google/Outlook with Calendar sync.\n\nThen allow LUCY calendar access when asked.',
      );
    }
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

  if (loading) return <View style={styles.center}><ActivityIndicator color={LUCY_COLORS.primary} /></View>;

  const conflictTitles = new Set<string>(); conflicts.forEach((c) => { conflictTitles.add(c.a); conflictTitles.add(c.b); });
  const today = dayKey(Date.now());
  const todayCount = blocks.filter((b) => dayKey(b.start) === today).length;
  const nextBlock = blocks.filter((b) => b.start >= Date.now()).sort((a, b) => a.start - b.start)[0];
  const focusMinutes = blocks
    .filter((b) => dayKey(b.start) === today && /focus|deep|write|code|study|design|review|plan|research/.test(`${b.title} ${describeResources(b.resources)}`.toLowerCase()))
    .reduce((sum, b) => sum + (b.end - b.start) / 60000, 0);

  const HOURS: number[] = []; for (let h = 6; h < 24; h++) HOURS.push(h);
  const G_START = 6 * 60; const PXM = 0.7; const G_H = (24 * 60 - G_START) * PXM;
  const localMin = (ms: number) => { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes(); };
  type Item = { id?: number; title: string; start: number; end: number; resources: Block['resources']; habit: boolean; device?: boolean };
  const habitsFor = (k: number): Item[] => {
    const dow = new Date(k).getDay();
    return (av?.protectedWindows || []).filter((h) => !h.days || h.days.includes(dow)).map((h) => ({
      title: h.label, start: k + h.startMin * 60000, end: k + h.endMin * 60000, habit: true, resources: { axes: [], location: null },
    }));
  };
  const dayItems = (k: number): Item[] => blocks
    .filter((b) => dayKey(b.start) === k)
    .map((b): Item => ({ id: b.id, title: b.title, start: b.start, end: b.end, resources: b.resources, habit: false, device: b.source === 'calendar' }))
    .concat(habitsFor(k))
    .sort((a, b) => a.start - b.start);
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
    if (it.habit) return;
    if (it.device) {
      Alert.alert(it.title, `${clock(it.start)} - ${clock(it.end)}\n\nFrom a calendar you connected (Google / Teams / Outlook). LUCY schedules around it but won't change it.`, [{ text: 'Close' }]);
      return;
    }
    if (!it.id) return;
    Alert.alert(it.title, `${clock(it.start)} - ${clock(it.end)}`, [
      { text: 'Close', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => remove(it.id!) },
    ]);
  };

  const DayCol = ({ k, w }: { k: number; w?: number }) => (
    <View style={[styles.dayCol, { height: G_H }, w ? { width: w } : { flex: 1 }]}>
      {HOURS.map((h) => <View key={h} style={[styles.hourLine, { top: (h * 60 - G_START) * PXM }]} />)}
      {dayItems(k).map((it, i) => {
        const top = Math.max(0, (localMin(it.start) - G_START) * PXM);
        const ht = Math.max(18, ((it.end - it.start) / 60000) * PXM);
        const c = it.habit ? '#8a8a8a' : it.device ? DEVICE_COLOR : catColor(it.title, describeResources(it.resources));
        return (
          <TouchableOpacity key={i} activeOpacity={0.82} onPress={() => onBlockPress(it)} style={[styles.gridEvent, { top, height: ht, backgroundColor: `${c}28`, borderLeftColor: c }, it.habit && styles.gridHabit]}>
            <Text numberOfLines={1} style={styles.gridEventTitle}>{it.device ? '📅 ' : ''}{it.title}</Text>
            {ht > 28 ? <Text style={styles.gridEventTime}>{clock(it.start)}</Text> : null}
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
      {HOURS.map((h) => <Text key={h} style={[styles.hourLabel, { top: (h * 60 - G_START) * PXM - 6 }]}>{(h % 12) || 12}{h < 12 ? 'a' : 'p'}</Text>)}
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
    if (view === 'day') return <View style={styles.gridWrap}><HourLabels /><DayCol k={ref} /></View>;
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
    if (!any) return <Text style={styles.emptyText}>Your schedule is open. Ask Lucy to place a task when you are ready.</Text>;
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
                      <Text style={styles.rowD}>{b.habit ? 'Habit window' : b.device ? 'From your calendar' : `${describeResources(b.resources)} • Lucy`}</Text>
                    </View>
                    {b.id && !b.habit ? <TouchableOpacity onPress={() => remove(b.id!)}><Text style={styles.x}>Remove</Text></TouchableOpacity> : null}
                  </TouchableOpacity>
                );
              })}
            </View>
          );
        })}
      </>
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
        <Text style={styles.heroMeta}>{conflicts.length ? `${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'}` : 'Conflict-free'}</Text>
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
        <View style={styles.syncedPill}><View style={styles.syncedDot} /><Text style={styles.syncedText}>Synced with your connected calendars</Text></View>
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
        <View style={styles.viewRow}>
          {(['day', 'agenda', 'week', 'month'] as const).map((v) => (
            <TouchableOpacity key={v} style={[styles.viewChip, view === v && styles.viewChipOn]} onPress={() => setView(v)}>
              <Text style={[styles.viewChipT, view === v && styles.viewChipTOn]}>{v === 'agenda' ? 'Upcoming' : v[0].toUpperCase() + v.slice(1)}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {renderBody()}
      </View>

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
              <Text style={styles.rowD}>{sugg.meta.durationMin} min - {describeResources(sugg.meta.resources)}</Text>
              {sugg.suggestions.map((s, i) => (
                <View key={i} style={styles.slotRow}>
                  <View style={{ flex: 1 }}><Text style={styles.rowT}>{dayLabel(s.start)} - {clock(s.start)} to {clock(s.end)}</Text><Text style={styles.rowD}>{s.reasons.join(', ')}</Text></View>
                  <TouchableOpacity style={styles.btnSm} onPress={() => accept(s)}><Text style={styles.btnT}>Add</Text></TouchableOpacity>
                </View>
              ))}
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

          {conflicts.length > 0 ? (
            <View style={[styles.resultCard, styles.conflictCard]}>
              <Text style={[styles.boxH, { color: LUCY_COLORS.error }]}>{conflicts.length} conflict{conflicts.length > 1 ? 's' : ''}</Text>
              {conflicts.map((c, i) => <Text key={i} style={styles.rowD}>{c.a} overlaps {c.b}. Lucy cannot run those in parallel.</Text>)}
            </View>
          ) : null}
        </>
      ) : null}
      {busy ? <View style={styles.busy}><ActivityIndicator color={LUCY_COLORS.primary} /></View> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  wrap: { padding: 14, paddingBottom: 76 },
  hero: { backgroundColor: LUCY_COLORS.surface, borderWidth: 1, borderColor: LUCY_COLORS.primaryLine, borderRadius: 26, padding: 18, marginBottom: 12, shadowColor: LUCY_COLORS.primary, shadowOpacity: 0.10, shadowRadius: 18, elevation: 4 },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  kicker: { color: LUCY_COLORS.primaryGlow, fontSize: 11, fontWeight: '900', letterSpacing: 1.1, textTransform: 'uppercase' },
  heroMeta: { color: LUCY_COLORS.textMuted, fontSize: 11, fontWeight: '800', backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
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
  weekStrip: { flexDirection: 'row', marginBottom: 12 },
  wsDay: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 4 },
  wsDow: { color: LUCY_COLORS.textSubtle, fontSize: 10.5, fontWeight: '800' },
  wsDowSel: { color: LUCY_COLORS.primary },
  wsNum: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  wsNumToday: { backgroundColor: LUCY_COLORS.primary },
  wsNumSel: { borderWidth: 1.5, borderColor: LUCY_COLORS.primary },
  wsNumT: { color: LUCY_COLORS.textDark, fontSize: 13.5, fontWeight: '800' },
  wsNumTOn: { color: '#fff' },
  wsDots: { flexDirection: 'row', gap: 2, height: 5 },
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
  nowLine: { position: 'absolute', left: 0, right: 0, height: 2, backgroundColor: '#FF4D4D' },
  nowDot: { position: 'absolute', left: -4, top: -3, width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF4D4D' },
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
  taskRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: LUCY_COLORS.border },
  slotRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, backgroundColor: LUCY_COLORS.surface, borderRadius: 15, borderWidth: 1, borderColor: LUCY_COLORS.border, padding: 12 },
  proposalWrap: { marginTop: 12 },
  conflictCard: { borderColor: LUCY_COLORS.error },
  timetableCard: { backgroundColor: LUCY_COLORS.surface, borderWidth: 1, borderColor: LUCY_COLORS.border, borderRadius: 24, padding: 15 },
  timetableHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
  section: { color: LUCY_COLORS.textDark, fontWeight: '900', fontSize: 20, marginTop: 3 },
  rangeL: { color: LUCY_COLORS.textMuted, fontSize: 12, fontWeight: '700', textAlign: 'right', flexShrink: 1 },
  viewRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12, flexWrap: 'wrap' },
  viewChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: LUCY_COLORS.surfaceRaised, borderWidth: 1, borderColor: LUCY_COLORS.border },
  viewChipOn: { backgroundColor: LUCY_COLORS.primary, borderColor: LUCY_COLORS.primary },
  viewChipT: { color: LUCY_COLORS.textMuted, fontSize: 12.5, fontWeight: '800' },
  viewChipTOn: { color: '#fff' },
  navBtn: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: LUCY_COLORS.border, backgroundColor: LUCY_COLORS.surfaceRaised },
  navT: { color: LUCY_COLORS.textDark, fontSize: 12.5, fontWeight: '800' },
  agendaDay: { marginBottom: 14 },
  dayH: { color: LUCY_COLORS.primaryGlow, fontWeight: '900', marginBottom: 8, fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase' },
  block: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: LUCY_COLORS.surfaceRaised, borderWidth: 1, borderColor: LUCY_COLORS.border, borderLeftWidth: 4, borderRadius: 16, padding: 12, marginBottom: 9 },
  blockConflict: { borderColor: LUCY_COLORS.error },
  blockHabit: { opacity: 0.68, borderStyle: 'dashed' },
  blockTimeWrap: { width: 76 },
  blockTime: { color: LUCY_COLORS.textDark, fontSize: 13, fontWeight: '900' },
  blockTimeEnd: { color: LUCY_COLORS.textSubtle, fontSize: 11, fontWeight: '700', marginTop: 2 },
  blockT: { color: LUCY_COLORS.textDark, fontWeight: '800', fontSize: 14, lineHeight: 20 },
  x: { color: LUCY_COLORS.textSubtle, fontSize: 12, fontWeight: '800', paddingHorizontal: 4 },
  gridWrap: { flexDirection: 'row', borderWidth: 1, borderColor: LUCY_COLORS.border, borderRadius: 18, padding: 10, backgroundColor: LUCY_COLORS.surfaceRaised },
  weekScroll: { borderWidth: 1, borderColor: LUCY_COLORS.border, borderRadius: 18, backgroundColor: LUCY_COLORS.surfaceRaised },
  weekContent: { padding: 10 },
  weekDay: { width: 116 },
  weekDayText: { textAlign: 'center', fontSize: 11, fontWeight: '800', color: LUCY_COLORS.textMuted, marginBottom: 5 },
  weekDayTextToday: { color: LUCY_COLORS.primary },
  dayCol: { position: 'relative', borderLeftWidth: 1, borderLeftColor: LUCY_COLORS.border },
  hourLabels: { width: 36, position: 'relative' },
  hourLabel: { position: 'absolute', fontSize: 9.5, color: LUCY_COLORS.textFaint },
  hourLine: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: LUCY_COLORS.border, opacity: 0.45 },
  gridEvent: { position: 'absolute', left: 3, right: 3, borderLeftWidth: 3, borderRadius: 9, padding: 4, overflow: 'hidden' },
  gridHabit: { opacity: 0.6, borderStyle: 'dashed' },
  gridEventTitle: { color: LUCY_COLORS.textDark, fontSize: 10.5, fontWeight: '800' },
  gridEventTime: { color: LUCY_COLORS.textMuted, fontSize: 9.5 },
  monthWrap: { gap: 6 },
  monthDays: { flexDirection: 'row' },
  monthDayText: { flex: 1, textAlign: 'center', color: LUCY_COLORS.textMuted, fontSize: 11, fontWeight: '800' },
  monthGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  monthCellBlank: { width: `${100 / 7}%`, aspectRatio: 1 },
  monthCellOuter: { width: `${100 / 7}%`, aspectRatio: 1, padding: 3 },
  monthCell: { flex: 1, borderWidth: 1, borderColor: LUCY_COLORS.border, borderRadius: 11, padding: 5, alignItems: 'center', backgroundColor: LUCY_COLORS.surfaceRaised },
  monthCellToday: { borderColor: LUCY_COLORS.primary, backgroundColor: LUCY_COLORS.primaryMist },
  monthCellDate: { fontSize: 12, fontWeight: '700', color: LUCY_COLORS.textDark },
  monthCellDateToday: { color: LUCY_COLORS.primary },
  monthCellCount: { marginTop: 3, backgroundColor: LUCY_COLORS.primary, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1, color: '#fff', fontSize: 10, fontWeight: '900', overflow: 'hidden' },
  busy: { paddingVertical: 16 },
});
