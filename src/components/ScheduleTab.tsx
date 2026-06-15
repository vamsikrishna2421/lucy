/**
 * ScheduleTab — in-app view of LUCY's self-contained calendar (Brain → Calendar). Mirrors the web
 * Calendar: find conflict-free time, plan-my-day, see the timetable, remove blocks. Calls the
 * on-device scheduling engine directly (no server, no OS calendar).
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
import type { AvailabilityProfile, Block, SlotSuggestion, TaskResources } from '../scheduling/types';

function clock(ms: number): string { return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
function dayKey(ms: number): number { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }
function dayLabel(ms: number): string {
  const t = dayKey(Date.now()); const d = dayKey(ms);
  if (d === t) return 'Today'; if (d === t + 86400000) return 'Tomorrow';
  return new Date(ms).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}
function hm(min: number): string { return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`; }
// Category → color (matches the web color legend).
const CATS: Array<[string, RegExp]> = [['#22C55E', /walk|gym|run|workout|yoga|exercise|meditat/], ['#F5C451', /lunch|dinner|breakfast|meal|coffee|brunch/], ['#FF8C42', /call|meeting|standup|sync|interview|brief|1:1/], ['#A78BFA', /errand|buy|pick|store|grocery|bank|clinic|@/], ['#4DA3FF', /focus|deep|write|code|study|design|review|plan|research|report/]];
function catColor(title: string, label: string): string { const s = `${title} ${label}`.toLowerCase(); for (const [c, re] of CATS) if (re.test(s)) return c; return '#8AA4FF'; }

interface Sugg { meta: { title: string; durationMin: number; resources: TaskResources; energy: string; location?: string | null }; suggestions: SlotSuggestion[]; todoId?: number | null }

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
  const [view, setView] = useState<'agenda' | 'day' | 'week' | 'month'>('agenda');
  const [ref, setRef] = useState<number>(dayKey(Date.now()));

  const load = useCallback(async () => {
    const db = await getDatabase();
    const now = Date.now();
    const [plan, a, us] = await Promise.all([
      getPlan(db, now - 2 * 3600_000, now + 42 * 86400_000),
      getAvailability(db),
      unscheduledPendingTodos(db),
    ]);
    setBlocks(plan.blocks); setConflicts(plan.conflicts.map((c) => ({ a: c.a.title, b: c.b.title })));
    setAv(a); setUnsched(us.slice(0, 12)); setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

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
    if (!sugg) return; setBusy(true);
    try {
      const db = await getDatabase();
      await commitBlock(db, { title: sugg.meta.title, startMs: s.start, endMs: s.end, resources: sugg.meta.resources, energy: sugg.meta.energy, location: sugg.meta.location ?? null, todoId: sugg.todoId ?? null });
      setSugg(null); setTask(''); await load();
    } finally { setBusy(false); }
  };

  const planDay = async () => {
    setBusy(true); setSugg(null);
    try { const db = await getDatabase(); const r = await autoPlanDay(db); setProposals(r.proposals); } finally { setBusy(false); }
  };
  const acceptProposal = async (p: DayProposal) => {
    setBusy(true);
    try { const db = await getDatabase(); await commitBlock(db, { title: p.title, startMs: p.start, endMs: p.end, resources: p.resources, energy: p.energy, todoId: p.todoId }); setProposals((prev) => prev?.filter((x) => x !== p) ?? null); await load(); } finally { setBusy(false); }
  };
  const acceptAll = async () => {
    if (!proposals) return; setBusy(true);
    try { const db = await getDatabase(); for (const p of proposals) { try { await commitBlock(db, { title: p.title, startMs: p.start, endMs: p.end, resources: p.resources, energy: p.energy, todoId: p.todoId }); } catch { /* skip */ } } setProposals(null); await load(); } finally { setBusy(false); }
  };
  const remove = async (id: number) => { setBusy(true); try { const db = await getDatabase(); await cancelBlock(db, id); await load(); } finally { setBusy(false); } };

  if (loading) return <View style={styles.center}><ActivityIndicator color={LUCY_COLORS.primary} /></View>;

  const conflictTitles = new Set<string>(); conflicts.forEach((c) => { conflictTitles.add(c.a); conflictTitles.add(c.b); });

  // ── view helpers (agenda/day/week/month) ──
  const HOURS: number[] = []; for (let h = 6; h < 24; h++) HOURS.push(h);
  const G_START = 6 * 60; const PXM = 0.7; const G_H = (24 * 60 - G_START) * PXM;
  const localMin = (ms: number) => { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes(); };
  type Item = { id?: number; title: string; start: number; end: number; resources: Block['resources']; habit: boolean };
  const habitsFor = (k: number): Item[] => { const dow = new Date(k).getDay(); return (av?.protectedWindows || []).filter((h) => !h.days || h.days.includes(dow)).map((h) => ({ title: h.label, start: k + h.startMin * 60000, end: k + h.endMin * 60000, habit: true, resources: { axes: [], location: null } })); };
  const dayItems = (k: number): Item[] => blocks.filter((b) => dayKey(b.start) === k).map((b): Item => ({ id: b.id, title: b.title, start: b.start, end: b.end, resources: b.resources, habit: false })).concat(habitsFor(k)).sort((a, b) => a.start - b.start);
  const weekDays = (): number[] => { const dow = new Date(ref).getDay(); const s = ref - dow * 86400000; return [0, 1, 2, 3, 4, 5, 6].map((i) => s + i * 86400000); };
  const navCal = (dir: number) => { if (view === 'month') { const d = new Date(ref); d.setMonth(d.getMonth() + dir); setRef(dayKey(d.getTime())); } else setRef(ref + dir * (view === 'week' ? 7 : 1) * 86400000); };
  const rangeLabel = () => { const d = new Date(ref); if (view === 'month') return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }); if (view === 'week') { const w = weekDays(); return `${new Date(w[0]).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}–${new Date(w[6]).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`; } if (view === 'day') return dayLabel(ref); return 'Next 7 days'; };
  const onBlockPress = (it: Item) => { if (it.habit || !it.id) return; Alert.alert(it.title, `${clock(it.start)}–${clock(it.end)}`, [{ text: 'Close', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => remove(it.id!) }]); };

  const DayCol = ({ k, w }: { k: number; w?: number }) => (
    <View style={[{ height: G_H, position: 'relative', borderLeftWidth: 1, borderLeftColor: LUCY_COLORS.border }, w ? { width: w } : { flex: 1 }]}>
      {HOURS.map((h) => <View key={h} style={{ position: 'absolute', top: (h * 60 - G_START) * PXM, left: 0, right: 0, height: 1, backgroundColor: LUCY_COLORS.border, opacity: 0.4 }} />)}
      {dayItems(k).map((it, i) => {
        const top = Math.max(0, (localMin(it.start) - G_START) * PXM);
        const ht = Math.max(15, ((it.end - it.start) / 60000) * PXM);
        const c = it.habit ? '#8a8a8a' : catColor(it.title, describeResources(it.resources));
        return (
          <TouchableOpacity key={i} activeOpacity={0.8} onPress={() => onBlockPress(it)} style={{ position: 'absolute', top, left: 2, right: 2, height: ht, backgroundColor: c + '28', borderLeftWidth: 3, borderLeftColor: c, borderRadius: 7, padding: 3, overflow: 'hidden', opacity: it.habit ? 0.6 : 1 }}>
            <Text numberOfLines={1} style={{ color: LUCY_COLORS.textDark, fontSize: 10.5, fontWeight: '600' }}>{it.title}</Text>
            {ht > 26 ? <Text style={{ color: LUCY_COLORS.textMuted, fontSize: 9.5 }}>{clock(it.start)}</Text> : null}
          </TouchableOpacity>
        );
      })}
    </View>
  );
  const HourLabels = () => (
    <View style={{ width: 34, height: G_H, position: 'relative' }}>
      {HOURS.map((h) => <Text key={h} style={{ position: 'absolute', top: (h * 60 - G_START) * PXM - 6, fontSize: 9.5, color: LUCY_COLORS.textFaint }}>{(h % 12) || 12}{h < 12 ? 'a' : 'p'}</Text>)}
    </View>
  );

  const renderBody = () => {
    if (view === 'month') {
      const d = new Date(ref); const y = d.getFullYear(); const m = d.getMonth();
      const startDow = new Date(y, m, 1).getDay(); const dim = new Date(y, m + 1, 0).getDate();
      const cells: Array<number | null> = []; for (let i = 0; i < startDow; i++) cells.push(null); for (let dd = 1; dd <= dim; dd++) cells.push(new Date(y, m, dd, 12).getTime()); while (cells.length % 7) cells.push(null);
      return (
        <View>
          <View style={{ flexDirection: 'row' }}>{['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((w, i) => <Text key={i} style={{ flex: 1, textAlign: 'center', color: LUCY_COLORS.textMuted, fontSize: 11 }}>{w}</Text>)}</View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {cells.map((k, i) => {
              if (!k) return <View key={i} style={{ width: `${100 / 7}%`, aspectRatio: 1 }} />;
              const dk = dayKey(k); const cnt = dayItems(dk).filter((x) => !x.habit).length; const isT = dk === dayKey(Date.now());
              return (
                <TouchableOpacity key={i} onPress={() => { setRef(dk); setView('day'); }} style={{ width: `${100 / 7}%`, aspectRatio: 1, padding: 3 }}>
                  <View style={{ flex: 1, borderWidth: 1, borderColor: isT ? LUCY_COLORS.primary : LUCY_COLORS.border, borderRadius: 9, padding: 4, alignItems: 'center' }}>
                    <Text style={{ fontSize: 12, fontWeight: isT ? '700' : '500', color: isT ? LUCY_COLORS.primary : LUCY_COLORS.textDark }}>{new Date(k).getDate()}</Text>
                    {cnt > 0 ? <View style={{ marginTop: 2, backgroundColor: LUCY_COLORS.primary, borderRadius: 9, paddingHorizontal: 6, paddingVertical: 1 }}><Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{cnt}</Text></View> : null}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      );
    }
    if (view === 'day') {
      return <View style={{ flexDirection: 'row', borderWidth: 1, borderColor: LUCY_COLORS.border, borderRadius: 12, padding: 8, backgroundColor: LUCY_COLORS.surfaceRaised }}><HourLabels /><DayCol k={ref} /></View>;
    }
    if (view === 'week') {
      return (
        <ScrollView horizontal showsHorizontalScrollIndicator style={{ borderWidth: 1, borderColor: LUCY_COLORS.border, borderRadius: 12, backgroundColor: LUCY_COLORS.surfaceRaised }} contentContainerStyle={{ padding: 8 }}>
          <HourLabels />
          {weekDays().map((k) => (
            <View key={k} style={{ width: 116 }}>
              <Text style={{ textAlign: 'center', fontSize: 11, fontWeight: '600', color: dayKey(k) === dayKey(Date.now()) ? LUCY_COLORS.primary : LUCY_COLORS.textMuted, marginBottom: 2 }}>{new Date(k).toLocaleDateString(undefined, { weekday: 'short' })} {new Date(k).getDate()}</Text>
              <DayCol k={k} w={116} />
            </View>
          ))}
        </ScrollView>
      );
    }
    // agenda
    const ds = [0, 1, 2, 3, 4, 5, 6].map((i) => dayKey(Date.now()) + i * 86400000);
    const any = ds.some((k) => dayItems(k).length);
    if (!any) return <Text style={styles.rowD}>Nothing scheduled. Use “Find time” or “Plan my day”.</Text>;
    return <>{ds.map((k) => { const items = dayItems(k); if (!items.length) return null; return (
      <View key={k} style={{ marginBottom: 12 }}>
        <Text style={styles.dayH}>{dayLabel(k)}</Text>
        {items.map((b, i) => {
          const conf = conflictTitles.has(b.title);
          return (
            <View key={i} style={[styles.block, { borderLeftWidth: 4, borderLeftColor: b.habit ? '#8a8a8a' : catColor(b.title, describeResources(b.resources)) }, conf && { borderColor: LUCY_COLORS.error }, b.habit && { opacity: 0.65, borderStyle: 'dashed' }]}>
              <Text style={styles.blockTime}>{clock(b.start)}–{clock(b.end)}</Text>
              <View style={{ flex: 1 }}><Text style={styles.blockT}>{b.title}{conf ? ' ⚠' : ''}</Text><Text style={styles.rowD}>{b.habit ? '✦ habit' : `${describeResources(b.resources)} · ◷ LUCY`}</Text></View>
              {b.id && !b.habit ? <TouchableOpacity onPress={() => remove(b.id!)}><Text style={styles.x}>✕</Text></TouchableOpacity> : null}
            </View>
          );
        })}
      </View>
    ); })}</>;
  };

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      {av && <Text style={styles.avLine}>On-device calendar · Work {hm(av.workStartMin)}–{hm(av.workEndMin)} · peak {av.peakWindows[0] ? `${hm(av.peakWindows[0].startMin)}–${hm(av.peakWindows[0].endMin)}` : '—'}</Text>}

      <View style={styles.findRow}>
        <TextInput style={styles.input} placeholder="Find time for… e.g. write the doc, call mom, gym" placeholderTextColor={LUCY_COLORS.textFaint} value={task} onChangeText={setTask} onSubmitEditing={() => doSuggest(task)} />
        <TouchableOpacity style={styles.btn} onPress={() => doSuggest(task)} disabled={busy}><Text style={styles.btnT}>Suggest</Text></TouchableOpacity>
      </View>

      {sugg && (
        <View style={styles.box}>
          <Text style={styles.boxH}>{sugg.suggestions.length ? `Best times for "${sugg.meta.title}" (${sugg.meta.durationMin} min · ${describeResources(sugg.meta.resources)})` : `No conflict-free slot for "${sugg.meta.title}"`}</Text>
          {sugg.suggestions.map((s, i) => (
            <View key={i} style={styles.row}>
              <View style={{ flex: 1 }}><Text style={styles.rowT}>{dayLabel(s.start)} · {clock(s.start)}–{clock(s.end)}</Text><Text style={styles.rowD}>{s.reasons.join(', ')}</Text></View>
              <TouchableOpacity style={styles.btnSm} onPress={() => accept(s)}><Text style={styles.btnT}>Add</Text></TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      <View style={styles.box}>
        <View style={styles.boxHead}><Text style={styles.boxH}>Unscheduled tasks{unsched.length ? ` (${unsched.length})` : ''}</Text><TouchableOpacity style={styles.btnSm} onPress={planDay} disabled={busy}><Text style={styles.btnT}>✦ Plan my day</Text></TouchableOpacity></View>
        {unsched.length === 0 && !proposals && <Text style={styles.rowD}>No pending tasks waiting to be scheduled.</Text>}
        {unsched.map((t) => (
          <View key={t.id} style={styles.row}><Text style={[styles.rowT, { flex: 1 }]} numberOfLines={1}>{t.task}</Text><TouchableOpacity style={styles.btnGhost} onPress={() => doSuggest(t.task, t.id)}><Text style={styles.btnGhostT}>Find time</Text></TouchableOpacity></View>
        ))}
        {proposals && (
          <View style={{ marginTop: 8 }}>
            <View style={styles.boxHead}><Text style={styles.boxH}>Proposed plan ({proposals.length})</Text>{proposals.length > 0 && <TouchableOpacity style={styles.btnSm} onPress={acceptAll}><Text style={styles.btnT}>Add all</Text></TouchableOpacity>}</View>
            {proposals.length === 0 && <Text style={styles.rowD}>Nothing fit your free time right now.</Text>}
            {proposals.map((p, i) => (
              <View key={i} style={styles.row}><View style={{ flex: 1 }}><Text style={styles.rowT}>{p.title}</Text><Text style={styles.rowD}>{dayLabel(p.start)} · {clock(p.start)}–{clock(p.end)} · {p.resourceLabel}</Text></View><TouchableOpacity style={styles.btnGhost} onPress={() => acceptProposal(p)}><Text style={styles.btnGhostT}>Add</Text></TouchableOpacity></View>
            ))}
          </View>
        )}
      </View>

      {conflicts.length > 0 && (
        <View style={[styles.box, { borderColor: LUCY_COLORS.error }]}>
          <Text style={[styles.boxH, { color: LUCY_COLORS.error }]}>⚠ {conflicts.length} conflict{conflicts.length > 1 ? 's' : ''}</Text>
          {conflicts.map((c, i) => <Text key={i} style={styles.rowD}>“{c.a}” overlaps “{c.b}” — can't run in parallel.</Text>)}
        </View>
      )}

      <Text style={styles.section}>Your timetable</Text>
      <View style={styles.viewRow}>
        {(['agenda', 'day', 'week', 'month'] as const).map((v) => (
          <TouchableOpacity key={v} style={[styles.viewChip, view === v && styles.viewChipOn]} onPress={() => setView(v)}>
            <Text style={[styles.viewChipT, view === v && styles.viewChipTOn]}>{v === 'month' ? '📅 Month' : v[0].toUpperCase() + v.slice(1)}</Text>
          </TouchableOpacity>
        ))}
        <View style={{ flex: 1 }} />
        <TouchableOpacity style={styles.navBtn} onPress={() => navCal(-1)}><Text style={styles.navT}>‹</Text></TouchableOpacity>
        <TouchableOpacity style={styles.navBtn} onPress={() => setRef(dayKey(Date.now()))}><Text style={styles.navT}>Today</Text></TouchableOpacity>
        <TouchableOpacity style={styles.navBtn} onPress={() => navCal(1)}><Text style={styles.navT}>›</Text></TouchableOpacity>
      </View>
      <Text style={styles.rangeL}>{rangeLabel()}</Text>
      {renderBody()}
      {busy && <View style={styles.busy}><ActivityIndicator color={LUCY_COLORS.primary} /></View>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  wrap: { padding: 14, paddingBottom: 60 },
  avLine: { color: LUCY_COLORS.textMuted, fontSize: 12, marginBottom: 12 },
  findRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  input: { flex: 1, backgroundColor: LUCY_COLORS.surfaceRaised, borderWidth: 1, borderColor: LUCY_COLORS.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: LUCY_COLORS.textDark },
  btn: { backgroundColor: LUCY_COLORS.primary, borderRadius: 10, paddingHorizontal: 16, justifyContent: 'center' },
  btnSm: { backgroundColor: LUCY_COLORS.primary, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 7, justifyContent: 'center' },
  btnT: { color: '#fff', fontWeight: '600', fontSize: 13 },
  btnGhost: { borderWidth: 1, borderColor: LUCY_COLORS.border, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 7 },
  btnGhostT: { color: LUCY_COLORS.textDark, fontSize: 13 },
  box: { backgroundColor: LUCY_COLORS.surfaceRaised, borderWidth: 1, borderColor: LUCY_COLORS.border, borderRadius: 12, padding: 14, marginBottom: 14 },
  boxHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  boxH: { color: LUCY_COLORS.textDark, fontWeight: '600', fontSize: 14, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: LUCY_COLORS.border },
  rowT: { color: LUCY_COLORS.textDark, fontWeight: '500', fontSize: 14 },
  rowD: { color: LUCY_COLORS.textMuted, fontSize: 12, marginTop: 2 },
  section: { color: LUCY_COLORS.textDark, fontWeight: '700', fontSize: 15, marginVertical: 8 },
  dayH: { color: LUCY_COLORS.textMuted, fontWeight: '600', marginBottom: 6 },
  block: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: LUCY_COLORS.surfaceRaised, borderWidth: 1, borderColor: LUCY_COLORS.border, borderRadius: 10, padding: 11, marginBottom: 8 },
  blockTime: { color: LUCY_COLORS.textMuted, fontSize: 12, minWidth: 96 },
  blockT: { color: LUCY_COLORS.textDark, fontWeight: '500' },
  x: { color: LUCY_COLORS.textMuted, fontSize: 16, paddingHorizontal: 6 },
  busy: { paddingVertical: 16 },
  viewRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' },
  viewChip: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 16, backgroundColor: LUCY_COLORS.surfaceRaised, borderWidth: 1, borderColor: LUCY_COLORS.border },
  viewChipOn: { backgroundColor: LUCY_COLORS.primary, borderColor: LUCY_COLORS.primary },
  viewChipT: { color: LUCY_COLORS.textMuted, fontSize: 12.5, fontWeight: '600' },
  viewChipTOn: { color: '#fff' },
  navBtn: { paddingHorizontal: 9, paddingVertical: 6, borderRadius: 14, borderWidth: 1, borderColor: LUCY_COLORS.border },
  navT: { color: LUCY_COLORS.textDark, fontSize: 12.5, fontWeight: '600' },
  rangeL: { color: LUCY_COLORS.textMuted, fontSize: 12, marginBottom: 10 },
});
