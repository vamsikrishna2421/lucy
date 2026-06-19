/**
 * ProjectsTab — Workspace → Projects. A dedicated space for each personal project. v1: create,
 * list, open a project space (shows its live activity: pending tasks + scheduled blocks that
 * mention it), delete. Deeper per-project linking comes next.
 */
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { LUCY_COLORS } from '../config/colors';
import { getDatabase } from '../db';
import { listProjects, createProject, deleteProject, projectActivity, type ProjectRow } from '../db/projects';
import { deriveProjectSuggestions, dismissProjectSuggestion, mergeSuggestionIntoProject, type ProjectSuggestion } from '../processing/projectAutopilot';

export function ProjectsTab() {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [open, setOpen] = useState<ProjectRow | null>(null);
  const [activity, setActivity] = useState<{ tasks: number; blocks: number } | null>(null);
  const [suggestions, setSuggestions] = useState<ProjectSuggestion[]>([]);
  const [mergeFor, setMergeFor] = useState<ProjectSuggestion | null>(null);

  const load = useCallback(async () => {
    const db = await getDatabase();
    setProjects(await listProjects(db));
    try { setSuggestions(await deriveProjectSuggestions(db)); } catch { /* optional */ }
    setLoading(false);
  }, []);

  const createSuggested = async (s: ProjectSuggestion) => {
    setSuggestions((list) => list.filter((x) => x.name !== s.name));
    const db = await getDatabase();
    await createProject(db, s.name, `Auto-gathered from ${s.evidence} related notes.`);
    await load();
  };
  const dismissSuggested = async (s: ProjectSuggestion) => {
    setSuggestions((list) => list.filter((x) => x.name !== s.name));
    const db = await getDatabase();
    await dismissProjectSuggestion(db, s.name);
  };
  const mergeSuggested = async (s: ProjectSuggestion, p: ProjectRow) => {
    setMergeFor(null);
    setSuggestions((list) => list.filter((x) => x.name !== s.name));
    const db = await getDatabase();
    await mergeSuggestionIntoProject(db, p.id, s.name);
    await load();
    Alert.alert('Folded in', `"${s.name}" now feeds into ${p.name}.`);
  };
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!open) { setActivity(null); return; }
    let live = true;
    (async () => { const db = await getDatabase(); const a = await projectActivity(db, open.name); if (live) setActivity(a); })();
    return () => { live = false; };
  }, [open]);

  const add = async () => {
    if (!name.trim()) return;
    const db = await getDatabase();
    await createProject(db, name, desc);
    setName(''); setDesc(''); setAdding(false); await load();
  };
  const remove = (p: ProjectRow) => {
    Alert.alert('Delete project?', `"${p.name}" will be removed.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { const db = await getDatabase(); await deleteProject(db, p.id); setOpen(null); await load(); } },
    ]);
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={LUCY_COLORS.primary} /></View>;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.wrap}>
        <View style={styles.head}>
          <Text style={styles.h}>Projects</Text>
          <TouchableOpacity style={styles.btn} onPress={() => setAdding(true)}><Text style={styles.btnT}>＋ New project</Text></TouchableOpacity>
        </View>
        <Text style={styles.sub}>A dedicated space for each personal project.</Text>

        {suggestions.length > 0 && (
          <View style={styles.sgBox}>
            <Text style={styles.sgHead}>✦ LUCY noticed these</Text>
            {suggestions.map((s) => (
              <View key={s.name} style={styles.sgRow}>
                <View style={styles.sgTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sgName}>{s.name}</Text>
                    <Text style={styles.sgMeta}>{s.evidence} related notes — make it a project?</Text>
                  </View>
                  <TouchableOpacity style={styles.sgDismiss} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} onPress={() => void dismissSuggested(s)}><Text style={styles.sgDismissT}>✕</Text></TouchableOpacity>
                </View>
                <View style={styles.sgActions}>
                  <TouchableOpacity style={styles.sgCreate} onPress={() => void createSuggested(s)}><Text style={styles.sgCreateT}>＋ Create</Text></TouchableOpacity>
                  <TouchableOpacity style={styles.sgMerge} onPress={() => setMergeFor(s)}><Text style={styles.sgMergeT}>Add to existing ▾</Text></TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}

        {projects.length === 0 && <Text style={styles.empty}>No projects yet. Create one to give it a home.</Text>}
        {projects.map((p) => (
          <TouchableOpacity key={p.id} style={styles.card} onPress={() => setOpen(p)}>
            <View style={styles.dot} />
            <View style={{ flex: 1 }}>
              <Text style={styles.cardT}>{p.name}</Text>
              {p.description ? <Text style={styles.cardD} numberOfLines={1}>{p.description}</Text> : null}
            </View>
            <Text style={styles.chev}>›</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* New project */}
      <Modal visible={adding} transparent animationType="slide" onRequestClose={() => setAdding(false)}>
        <View style={styles.modalBg}><View style={styles.sheet}>
          <Text style={styles.h}>New project</Text>
          <TextInput style={styles.input} placeholder="Project name" placeholderTextColor={LUCY_COLORS.textFaint} value={name} onChangeText={setName} />
          <TextInput style={[styles.input, { height: 80 }]} placeholder="Description (optional)" placeholderTextColor={LUCY_COLORS.textFaint} value={desc} onChangeText={setDesc} multiline />
          <View style={styles.rowEnd}>
            <TouchableOpacity style={styles.btnGhost} onPress={() => setAdding(false)}><Text style={styles.btnGhostT}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity style={styles.btn} onPress={add}><Text style={styles.btnT}>Create</Text></TouchableOpacity>
          </View>
        </View></View>
      </Modal>

      {/* Add suggestion to an existing project */}
      <Modal visible={!!mergeFor} transparent animationType="slide" onRequestClose={() => setMergeFor(null)}>
        <TouchableOpacity style={styles.modalBg} activeOpacity={1} onPress={() => setMergeFor(null)}>
          <TouchableOpacity style={styles.sheet} activeOpacity={1} onPress={() => {}}>
            <View style={styles.grip} />
            <Text style={styles.eyebrow}>FOLD INTO A PROJECT</Text>
            <Text style={styles.h}>Add to existing</Text>
            {mergeFor && <Text style={styles.sub}>“{mergeFor.name}” and its {mergeFor.evidence} related notes will start feeding into the project you pick.</Text>}
            {projects.length === 0 ? (
              <Text style={styles.pickEmpty}>You have no projects yet. Use ＋ Create to make this its own project.</Text>
            ) : (
              <ScrollView style={{ maxHeight: 340 }} contentContainerStyle={{ paddingBottom: 4 }}>
                {projects.map((p) => (
                  <TouchableOpacity key={p.id} style={styles.pickRow} onPress={() => mergeFor && void mergeSuggested(mergeFor, p)}>
                    <View style={styles.dot} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.pickName}>{p.name}</Text>
                      {p.description ? <Text style={styles.pickDesc} numberOfLines={1}>{p.description}</Text> : null}
                    </View>
                    <Text style={styles.chev}>›</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
            <View style={styles.rowEnd}>
              <TouchableOpacity style={styles.btnGhost} onPress={() => setMergeFor(null)}><Text style={styles.btnGhostT}>Cancel</Text></TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Project space */}
      <Modal visible={!!open} transparent animationType="slide" onRequestClose={() => setOpen(null)}>
        <View style={styles.modalBg}><View style={styles.sheet}>
          <View style={styles.head}><Text style={styles.h}>{open?.name}</Text><TouchableOpacity onPress={() => setOpen(null)}><Text style={styles.x}>✕</Text></TouchableOpacity></View>
          {open?.description ? <Text style={styles.sub}>{open.description}</Text> : null}
          <View style={styles.stats}>
            <View style={styles.stat}><Text style={styles.statN}>{activity?.tasks ?? '—'}</Text><Text style={styles.statL}>open tasks</Text></View>
            <View style={styles.stat}><Text style={styles.statN}>{activity?.blocks ?? '—'}</Text><Text style={styles.statL}>scheduled</Text></View>
          </View>
          <Text style={styles.note}>Tasks and calendar blocks that mention "{open?.name}" show up here. Deeper linking (docs, notes per project) is coming.</Text>
          {open && <TouchableOpacity style={[styles.btnGhost, { alignSelf: 'flex-start', marginTop: 14 }]} onPress={() => remove(open)}><Text style={[styles.btnGhostT, { color: LUCY_COLORS.error }]}>Delete project</Text></TouchableOpacity>}
        </View></View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  wrap: { padding: 14, paddingBottom: 72 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  h: { color: LUCY_COLORS.textDark, fontWeight: '900', fontSize: 21 },
  sub: { color: LUCY_COLORS.textMuted, fontSize: 13, marginTop: 6, marginBottom: 14, lineHeight: 19 },
  empty: { color: LUCY_COLORS.textMuted, fontSize: 13, marginTop: 20, textAlign: 'center', backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 18, padding: 18, lineHeight: 20 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: LUCY_COLORS.surfaceRaised, borderWidth: 1, borderColor: LUCY_COLORS.border, borderTopColor: LUCY_COLORS.primaryLine, borderRadius: 16, padding: 14, marginBottom: 10 },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: LUCY_COLORS.primary, shadowColor: LUCY_COLORS.primary, shadowOpacity: 0.45, shadowRadius: 7 },
  cardT: { color: LUCY_COLORS.textDark, fontWeight: '800', fontSize: 15 },
  cardD: { color: LUCY_COLORS.textMuted, fontSize: 12, marginTop: 2 },
  chev: { color: LUCY_COLORS.textFaint, fontSize: 22 },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: LUCY_COLORS.surfaceSheet, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 34, borderTopWidth: 1, borderTopColor: LUCY_COLORS.border },
  input: { backgroundColor: LUCY_COLORS.surfaceRaised, borderWidth: 1, borderColor: LUCY_COLORS.border, borderRadius: 14, padding: 12, color: LUCY_COLORS.textDark, marginTop: 10 },
  rowEnd: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 14 },
  btn: { backgroundColor: LUCY_COLORS.primary, borderRadius: 13, paddingHorizontal: 16, paddingVertical: 10, justifyContent: 'center' },
  btnT: { color: '#fff', fontWeight: '800' },
  btnGhost: { borderWidth: 1, borderColor: LUCY_COLORS.border, borderRadius: 13, paddingHorizontal: 16, paddingVertical: 10 },
  btnGhostT: { color: LUCY_COLORS.textDark },
  x: { color: LUCY_COLORS.textMuted, fontSize: 18 },
  stats: { flexDirection: 'row', gap: 12, marginTop: 14 },
  stat: { flex: 1, backgroundColor: LUCY_COLORS.surfaceRaised, borderWidth: 1, borderColor: LUCY_COLORS.border, borderRadius: 16, padding: 14, alignItems: 'center' },
  statN: { color: LUCY_COLORS.primary, fontWeight: '900', fontSize: 23 },
  statL: { color: LUCY_COLORS.textMuted, fontSize: 12, marginTop: 2 },
  note: { color: LUCY_COLORS.textMuted, fontSize: 12, marginTop: 14, lineHeight: 17 },
  sgBox: { backgroundColor: 'rgba(255,140,66,0.07)', borderWidth: 1, borderColor: LUCY_COLORS.primaryLine, borderRadius: 16, padding: 12, marginBottom: 14 },
  sgHead: { color: LUCY_COLORS.primaryGlow, fontWeight: '800', fontSize: 12, marginBottom: 8, letterSpacing: 0.4 },
  sgRow: { paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: LUCY_COLORS.primaryLine },
  sgTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  sgName: { color: LUCY_COLORS.textDark, fontWeight: '700', fontSize: 14 },
  sgMeta: { color: LUCY_COLORS.textMuted, fontSize: 12, marginTop: 1, lineHeight: 16 },
  sgActions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 9 },
  sgCreate: { backgroundColor: LUCY_COLORS.primary, borderRadius: 11, paddingHorizontal: 14, paddingVertical: 8 },
  sgCreateT: { color: '#fff', fontWeight: '800', fontSize: 12.5 },
  sgMerge: { borderWidth: 1, borderColor: LUCY_COLORS.primaryLine, borderRadius: 11, paddingHorizontal: 14, paddingVertical: 8 },
  sgMergeT: { color: LUCY_COLORS.primaryGlow, fontWeight: '700', fontSize: 12.5 },
  sgDismiss: { paddingHorizontal: 4, paddingVertical: 2 },
  sgDismissT: { color: LUCY_COLORS.textFaint, fontSize: 15 },
  // Add-to-existing picker sheet
  grip: { width: 40, height: 4, borderRadius: 2, backgroundColor: LUCY_COLORS.border, alignSelf: 'center', marginBottom: 14 },
  eyebrow: { color: LUCY_COLORS.primaryGlow, fontWeight: '900', fontSize: 11, letterSpacing: 1, marginBottom: 4 },
  pickEmpty: { color: LUCY_COLORS.textMuted, fontSize: 13, marginTop: 14, backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 14, padding: 16, lineHeight: 19 },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: LUCY_COLORS.surfaceRaised, borderWidth: 1, borderColor: LUCY_COLORS.border, borderRadius: 14, padding: 13, marginTop: 10 },
  pickName: { color: LUCY_COLORS.textDark, fontWeight: '800', fontSize: 14 },
  pickDesc: { color: LUCY_COLORS.textMuted, fontSize: 12, marginTop: 2 },
});
