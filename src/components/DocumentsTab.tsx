/**
 * DocumentsTab — the in-app Document Vault view (Brain → Documents), mirroring the web
 * Documents Manager: bucket chips, smart search, thumbnail grid, a detail sheet, upload.
 * Reads/writes the same vault_items the web server uses (src/processing/documentVault).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { LUCY_COLORS } from '../config/colors';
import { getDatabase } from '../db';
import { listVaultItems, refileVaultItem, deleteVaultItem, VAULT_BUCKETS, type VaultItem } from '../processing/documentVault';

// ─── smart search (ported from the web Documents Manager) ────────────────────
const SYN = [['payslip', 'payslips', 'salary', 'salaryslip', 'salary slip', 'pay slip', 'wage', 'wages', 'paystub', 'paycheck'], ['usa', 'us', 'america', 'american', 'united states'], ['india', 'indian', 'bharat', 'ind'], ['uk', 'united kingdom', 'britain', 'british', 'england'], ['id', 'identity', 'identification', 'card', 'cards'], ['certificate', 'certificates', 'cert', 'certification'], ['invoice', 'invoices', 'bill', 'bills', 'receipt', 'receipts'], ['statement', 'statements', 'bank statement'], ['visa', 'visas'], ['passport', 'passports'], ['tax', 'taxes', 'taxation', 'w2', '1099', 'itr'], ['insurance', 'policy', 'policies'], ['offer', 'offer letter']];
const STOP = new Set(['doc', 'docs', 'document', 'documents', 'file', 'files', 'my', 'all', 'the', 'a', 'an', 'of', 'for', 'in', 'on', 'show', 'find', 'get', 'me', 'please', 'related', 'about', 'any', 'some']);
const NEG = new Set(['ignore', 'except', 'exclude', 'excluding', 'without', 'not', 'no', 'minus', 'but']);
function expand(t: string): string[] { for (const g of SYN) if (g.includes(t)) return g; return t.length > 4 && t.endsWith('s') ? [t, t.slice(0, -1)] : [t]; }
function hit(hay: string, s: string): boolean { return new RegExp('\\b' + s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(hay); }
function parseQuery(q: string): { pos: string[]; neg: string[] } {
  const ts = q.toLowerCase().replace(/,/g, ' ').split(/\s+/).filter(Boolean); const pos: string[] = []; const neg: string[] = []; let m = 'pos';
  for (const t of ts) { if (t === '-') continue; if (t.startsWith('-') && t.length > 1) { neg.push(t.slice(1)); continue; } if (NEG.has(t)) { m = 'neg'; continue; } if (STOP.has(t)) continue; (m === 'pos' ? pos : neg).push(t); }
  return { pos, neg };
}
function matchDoc(it: VaultItem, q: string): boolean {
  const hay = `${it.title || ''} ${it.description || ''} ${it.bucket || ''} ${it.keywords || ''}`.toLowerCase();
  const { pos, neg } = parseQuery(q);
  if (neg.some((t) => expand(t).some((s) => hit(hay, s)))) return false;
  if (!pos.length) return true;
  return pos.every((t) => expand(t).some((s) => hit(hay, s)));
}

export function DocumentsTab() {
  const [items, setItems] = useState<VaultItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [bucket, setBucket] = useState('All');
  const [selected, setSelected] = useState<VaultItem | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);

  const load = useCallback(async () => {
    const db = await getDatabase();
    setItems(await listVaultItems(db));
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const buckets = useMemo(() => ['All', ...Array.from(new Set(items.map((i) => i.bucket || 'Other')))], [items]);
  const shown = useMemo(() => {
    let list = items.filter((i) => bucket === 'All' || (i.bucket || 'Other') === bucket);
    if (query.trim()) list = list.filter((i) => matchDoc(i, query));
    return list;
  }, [items, bucket, query]);

  const upload = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') { Alert.alert('Permission needed', 'Allow photo access to add documents.'); return; }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, quality: 0.8 });
    if (res.canceled || !res.assets?.length) return;
    const { saveImageToVault } = await import('../processing/documentVault');
    let ok = 0; let dup = 0;
    for (let i = 0; i < res.assets.length; i++) {
      setUploading(`Filing ${i + 1} of ${res.assets.length}…`);
      try {
        const r = await saveImageToVault(res.assets[i].uri, res.assets[i].fileName ?? 'document', null, true, null);
        if (r.duplicate) dup++; else if (r.item) ok++;
      } catch { /* skip */ }
      await load();
    }
    setUploading(null);
    Alert.alert('Done', `Filed ${ok} document${ok === 1 ? '' : 's'}${dup ? ` · ${dup} duplicate(s) skipped` : ''}.`);
  };

  const refile = (it: VaultItem) => {
    const opts = Array.from(new Set([...buckets.filter((b) => b !== 'All'), ...VAULT_BUCKETS]));
    Alert.alert('Move to…', it.title ?? 'Document', [
      ...opts.slice(0, 10).map((b) => ({ text: b, onPress: async () => { const db = await getDatabase(); await refileVaultItem(db, it.id, b); setSelected(null); await load(); } })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };
  const remove = (it: VaultItem) => {
    Alert.alert('Delete document?', it.title ?? '', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { const db = await getDatabase(); await deleteVaultItem(db, it.id); setSelected(null); await load(); } },
    ]);
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={LUCY_COLORS.primary} /></View>;

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.headerRow}>
        <Text style={styles.count}>{items.length} document{items.length === 1 ? '' : 's'}</Text>
        <TouchableOpacity style={styles.uploadBtn} onPress={() => void upload()} disabled={!!uploading}>
          <Text style={styles.uploadText}>{uploading ?? '＋ Upload'}</Text>
        </TouchableOpacity>
      </View>
      <TextInput
        style={styles.search}
        placeholder="Search — nokia payslips, usa docs, visa…"
        placeholderTextColor={LUCY_COLORS.textFaint}
        value={query}
        onChangeText={setQuery}
        autoCapitalize="none"
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
        {buckets.map((b) => (
          <TouchableOpacity key={b} style={[styles.chip, b === bucket && styles.chipOn]} onPress={() => setBucket(b)}>
            <Text style={[styles.chipText, b === bucket && styles.chipTextOn]}>{b}{b !== 'All' ? ` ${items.filter((i) => (i.bucket || 'Other') === b).length}` : ''}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <ScrollView contentContainerStyle={styles.grid}>
        {shown.length === 0 ? (
          <Text style={styles.empty}>{query ? `No matches for “${query}”` : 'No documents yet — tap ＋ Upload.'}</Text>
        ) : shown.map((it) => (
          <TouchableOpacity key={it.id} style={styles.card} onPress={() => setSelected(it)}>
            <View style={styles.thumbWrap}>
              {(it.thumb || it.file_path) ? <Image source={{ uri: it.thumb || it.file_path || '' }} style={styles.thumb} resizeMode="cover" /> : <Text style={styles.thumbPh}>🗂</Text>}
              <Text style={styles.bucketTag} numberOfLines={1}>{it.bucket || 'Other'}</Text>
            </View>
            <Text style={styles.cardTitle} numberOfLines={2}>{it.title || 'Document'}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Modal visible={!!selected} transparent animationType="slide" onRequestClose={() => setSelected(null)}>
        <View style={styles.modalBg}>
          <View style={styles.sheet}>
            <TouchableOpacity style={styles.close} onPress={() => setSelected(null)}><Text style={styles.closeX}>✕</Text></TouchableOpacity>
            {selected ? (
              <ScrollView>
                {(selected.file_path || selected.thumb) ? <Image source={{ uri: selected.file_path || selected.thumb || '' }} style={styles.bigImg} resizeMode="contain" /> : null}
                <Text style={styles.dBucket}>{selected.bucket || 'Other'}</Text>
                <Text style={styles.dTitle}>{selected.title || 'Document'}</Text>
                {selected.description ? <Text style={styles.dDesc}>{selected.description}</Text> : null}
                {selected.keywords ? (
                  <View style={styles.kwRow}>
                    {selected.keywords.split(',').map((k) => k.trim()).filter(Boolean).slice(0, 12).map((k, i) => (
                      <Text key={i} style={styles.kw}>{k}</Text>
                    ))}
                  </View>
                ) : null}
                <View style={styles.actions}>
                  <TouchableOpacity style={styles.actBtn} onPress={() => refile(selected)}><Text style={styles.actText}>Move</Text></TouchableOpacity>
                  <TouchableOpacity style={[styles.actBtn, styles.delBtn]} onPress={() => remove(selected)}><Text style={[styles.actText, { color: LUCY_COLORS.error }]}>Delete</Text></TouchableOpacity>
                </View>
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  count: { color: LUCY_COLORS.textMuted, fontSize: 13, fontWeight: '600' },
  uploadBtn: { backgroundColor: LUCY_COLORS.primary, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8 },
  uploadText: { color: LUCY_COLORS.white, fontWeight: '700', fontSize: 13 },
  search: { backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 14, color: LUCY_COLORS.textDark, paddingHorizontal: 16, paddingVertical: 11, fontSize: 15, marginBottom: 12, borderWidth: 1, borderColor: LUCY_COLORS.border },
  chips: { flexGrow: 0, marginBottom: 12 },
  chip: { paddingHorizontal: 13, paddingVertical: 7, borderRadius: 18, marginRight: 7, backgroundColor: LUCY_COLORS.surfaceRaised, borderWidth: 1, borderColor: LUCY_COLORS.border },
  chipOn: { backgroundColor: LUCY_COLORS.primarySoft, borderColor: LUCY_COLORS.primary },
  chipText: { color: LUCY_COLORS.textMuted, fontWeight: '600', fontSize: 12.5 },
  chipTextOn: { color: LUCY_COLORS.primary },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', paddingBottom: 40 },
  empty: { color: LUCY_COLORS.textFaint, textAlign: 'center', width: '100%', marginTop: 50, fontSize: 14 },
  card: { width: '48%', marginBottom: 14, backgroundColor: LUCY_COLORS.surface, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: LUCY_COLORS.border },
  thumbWrap: { aspectRatio: 4 / 3, backgroundColor: LUCY_COLORS.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  thumb: { width: '100%', height: '100%' },
  thumbPh: { fontSize: 32, opacity: 0.4 },
  bucketTag: { position: 'absolute', bottom: 6, left: 6, backgroundColor: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 10, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 12, overflow: 'hidden', maxWidth: '90%' },
  cardTitle: { color: LUCY_COLORS.textDark, fontSize: 13, fontWeight: '600', padding: 10 },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: LUCY_COLORS.surfaceSheet, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, maxHeight: '88%' },
  close: { position: 'absolute', top: 12, right: 14, zIndex: 2, width: 32, height: 32, borderRadius: 16, backgroundColor: LUCY_COLORS.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  closeX: { color: LUCY_COLORS.textMuted, fontSize: 15 },
  bigImg: { width: '100%', height: 320, borderRadius: 14, backgroundColor: LUCY_COLORS.surfaceRaised, marginBottom: 14 },
  dBucket: { color: LUCY_COLORS.primary, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  dTitle: { color: LUCY_COLORS.textDark, fontSize: 19, fontWeight: '700', marginTop: 4, marginBottom: 8 },
  dDesc: { color: LUCY_COLORS.textMuted, fontSize: 14, lineHeight: 21 },
  kwRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12 },
  kw: { backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, fontSize: 11.5, color: LUCY_COLORS.textSubtle, marginRight: 6, marginBottom: 6, overflow: 'hidden' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 18, marginBottom: 10 },
  actBtn: { flex: 1, backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 12, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: LUCY_COLORS.border },
  delBtn: { borderColor: LUCY_COLORS.error },
  actText: { color: LUCY_COLORS.textDark, fontWeight: '700', fontSize: 14 },
});
