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

export function ProjectsTab() {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [open, setOpen] = useState<ProjectRow | null>(null);
  const [activity, setActivity] = useState<{ tasks: number; blocks: number } | null>(null);

  const load = useCallback(async () => {
    const db = await getDatabase();
    setProjects(await listProjects(db));
    setLoading(false);
  }, []);
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
  wrap: { padding: 14, paddingBottom: 60 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  h: { color: LUCY_COLORS.textDark, fontWeight: '700', fontSize: 18 },
  sub: { color: LUCY_COLORS.textMuted, fontSize: 13, marginTop: 4, marginBottom: 12 },
  empty: { color: LUCY_COLORS.textMuted, fontSize: 13, marginTop: 20, textAlign: 'center' },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: LUCY_COLORS.surfaceRaised, borderWidth: 1, borderColor: LUCY_COLORS.border, borderRadius: 12, padding: 14, marginBottom: 10 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: LUCY_COLORS.primary },
  cardT: { color: LUCY_COLORS.textDark, fontWeight: '600', fontSize: 15 },
  cardD: { color: LUCY_COLORS.textMuted, fontSize: 12, marginTop: 2 },
  chev: { color: LUCY_COLORS.textFaint, fontSize: 22 },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: LUCY_COLORS.surface ?? '#171310', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 34 },
  input: { backgroundColor: LUCY_COLORS.surfaceRaised, borderWidth: 1, borderColor: LUCY_COLORS.border, borderRadius: 10, padding: 12, color: LUCY_COLORS.textDark, marginTop: 10 },
  rowEnd: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 14 },
  btn: { backgroundColor: LUCY_COLORS.primary, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 9, justifyContent: 'center' },
  btnT: { color: '#fff', fontWeight: '600' },
  btnGhost: { borderWidth: 1, borderColor: LUCY_COLORS.border, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 9 },
  btnGhostT: { color: LUCY_COLORS.textDark },
  x: { color: LUCY_COLORS.textMuted, fontSize: 18 },
  stats: { flexDirection: 'row', gap: 12, marginTop: 14 },
  stat: { flex: 1, backgroundColor: LUCY_COLORS.surfaceRaised, borderWidth: 1, borderColor: LUCY_COLORS.border, borderRadius: 12, padding: 14, alignItems: 'center' },
  statN: { color: LUCY_COLORS.primary, fontWeight: '700', fontSize: 22 },
  statL: { color: LUCY_COLORS.textMuted, fontSize: 12, marginTop: 2 },
  note: { color: LUCY_COLORS.textMuted, fontSize: 12, marginTop: 14, lineHeight: 17 },
});
