import { useEffect, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LUCY_COLORS, LUCY_SHADOWS } from '../config/colors';
import { getDatabase } from '../db';
import { clearDevLogs, listDevLogs, type DevLogRow } from '../db/devLog';

const CATEGORY_COLOR: Record<string, string> = {
  extraction: LUCY_COLORS.primary,
  ask: LUCY_COLORS.info,
  whisper: LUCY_COLORS.violet,
  meeting: LUCY_COLORS.teal,
  error: LUCY_COLORS.error,
};

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatAge(iso: string): string {
  const ms = Date.now() - new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function DevLogViewer({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [logs, setLogs] = useState<DevLogRow[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    if (visible) void load();
  }, [visible]);

  const load = async () => {
    const db = await getDatabase();
    setLogs(await listDevLogs(db, 100));
  };

  const clearAll = () => {
    Alert.alert('Clear dev logs?', 'All AI call history will be deleted.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear', style: 'destructive',
        onPress: async () => {
          const db = await getDatabase();
          await clearDevLogs(db);
          setLogs([]);
        },
      },
    ]);
  };

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.sheet} onPress={() => {}}>
          <View style={s.header}>
            <Text style={s.title}>Dev Log</Text>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity onPress={clearAll}><Text style={s.clearBtn}>Clear</Text></TouchableOpacity>
              <TouchableOpacity onPress={onClose}><Text style={s.closeBtn}>Done</Text></TouchableOpacity>
            </View>
          </View>
          <Text style={s.subtitle}>Last {logs.length} AI calls · tap a row to expand</Text>

          <ScrollView showsVerticalScrollIndicator={false} style={s.list}>
            {logs.length === 0 ? (
              <Text style={s.empty}>No AI calls logged yet. Run a capture or ask a question.</Text>
            ) : logs.map((row) => {
              const accent = CATEGORY_COLOR[row.category] ?? LUCY_COLORS.textSubtle;
              const isExp = expanded === row.id;
              return (
                <TouchableOpacity key={row.id} style={s.row} onPress={() => setExpanded(isExp ? null : row.id)} activeOpacity={0.75}>
                  <View style={[s.catBar, { backgroundColor: accent }]} />
                  <View style={{ flex: 1, gap: 3 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <View style={[s.catPill, { backgroundColor: `${accent}22` }]}>
                        <Text style={[s.catText, { color: accent }]}>{row.category.toUpperCase()}</Text>
                      </View>
                      <Text style={s.model}>{row.model || '—'}</Text>
                      <View style={{ flex: 1 }} />
                      <Text style={s.meta}>{formatMs(row.duration_ms)}</Text>
                      <Text style={s.meta}>{formatAge(row.created_at)}</Text>
                    </View>
                    {row.error ? (
                      <Text style={s.errorText} numberOfLines={isExp ? undefined : 1}>⚠ {row.error}</Text>
                    ) : (
                      <Text style={s.preview} numberOfLines={isExp ? undefined : 1}>{row.output_preview || '—'}</Text>
                    )}
                    {isExp ? (
                      <View style={s.expanded}>
                        <Text style={s.expandLabel}>INPUT</Text>
                        <Text style={s.expandBody}>{row.input_preview}</Text>
                        <Text style={[s.expandLabel, { marginTop: 8 }]}>OUTPUT</Text>
                        <Text style={s.expandBody}>{row.output_preview || row.error || '—'}</Text>
                      </View>
                    ) : null}
                  </View>
                </TouchableOpacity>
              );
            })}
            <View style={{ height: 32 }} />
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(20,22,40,0.40)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: LUCY_COLORS.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderTopColor: LUCY_COLORS.border, maxHeight: '92%', ...LUCY_SHADOWS.lg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingBottom: 6 },
  title: { color: LUCY_COLORS.textDark, fontSize: 18, fontWeight: '800' },
  subtitle: { color: LUCY_COLORS.textSubtle, fontSize: 11, paddingHorizontal: 20, paddingBottom: 10 },
  clearBtn: { color: LUCY_COLORS.error, fontSize: 13, fontWeight: '700' },
  closeBtn: { color: LUCY_COLORS.primary, fontSize: 15, fontWeight: '700' },
  list: { paddingHorizontal: 16 },
  empty: { color: LUCY_COLORS.textSubtle, textAlign: 'center', padding: 32, fontSize: 13 },
  row: { flexDirection: 'row', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: LUCY_COLORS.divider },
  catBar: { width: 3, borderRadius: 2, alignSelf: 'stretch', minHeight: 20 },
  catPill: { borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  catText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.6 },
  model: { color: LUCY_COLORS.textSubtle, fontSize: 11 },
  meta: { color: LUCY_COLORS.textSubtle, fontSize: 10 },
  preview: { color: LUCY_COLORS.textMuted, fontSize: 12, lineHeight: 17 },
  errorText: { color: LUCY_COLORS.error, fontSize: 12, lineHeight: 17 },
  expanded: { marginTop: 8, backgroundColor: LUCY_COLORS.background, borderRadius: 8, padding: 10, gap: 2 },
  expandLabel: { color: LUCY_COLORS.textSubtle, fontSize: 9, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  expandBody: { color: LUCY_COLORS.textMuted, fontSize: 11, lineHeight: 16 },
});
