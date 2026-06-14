/**
 * ScheduleTab — in-app view of LUCY's self-contained calendar (Brain → Calendar). Mirrors the web
 * Calendar: find conflict-free time, plan-my-day, see the timetable, remove blocks. Calls the
 * on-device scheduling engine directly (no server, no OS calendar).
 */
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
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

  const load = useCallback(async () => {
    const db = await getDatabase();
    const now = Date.now();
    const [plan, a, us] = await Promise.all([
      getPlan(db, now - 2 * 3600_000, now + 3 * 86400_000),
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
  const byDay: Record<number, Block[]> = {};
  blocks.slice().sort((a, b) => a.start - b.start).forEach((b) => { (byDay[dayKey(b.start)] = byDay[dayKey(b.start)] || []).push(b); });

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
      {blocks.length === 0 && <Text style={styles.rowD}>Nothing scheduled. Use “Find time” or “Plan my day”.</Text>}
      {Object.keys(byDay).map(Number).sort((a, b) => a - b).map((k) => (
        <View key={k} style={{ marginBottom: 12 }}>
          <Text style={styles.dayH}>{dayLabel(k)}</Text>
          {byDay[k].map((b, i) => {
            const conf = conflictTitles.has(b.title);
            return (
              <View key={i} style={[styles.block, { borderLeftWidth: 4, borderLeftColor: catColor(b.title, describeResources(b.resources)) }, conf && { borderColor: LUCY_COLORS.error }]}>
                <Text style={styles.blockTime}>{clock(b.start)}–{clock(b.end)}</Text>
                <View style={{ flex: 1 }}><Text style={styles.blockT}>{b.title}{conf ? ' ⚠' : ''}</Text><Text style={styles.rowD}>{describeResources(b.resources)} · {b.source === 'scheduled' ? '◷ LUCY' : '📅'}</Text></View>
                {b.id ? <TouchableOpacity onPress={() => remove(b.id!)}><Text style={styles.x}>✕</Text></TouchableOpacity> : null}
              </View>
            );
          })}
        </View>
      ))}
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
});
