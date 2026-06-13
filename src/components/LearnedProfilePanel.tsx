import { useEffect, useState, useCallback } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LUCY_COLORS } from '../config/colors';
import { getDatabase } from '../db';
import { listLearnedFacts, deleteLearnedFact, type LearnedFactRow } from '../db/learnedProfile';

const CATEGORY_EMOJI: Record<string, string> = {
  preference: '⚙️', habit: '🔁', trait: '🧬', routine: '🗓️', goal: '🎯', relationship: '🤝', correction: '✏️',
};

/**
 * "What LUCY has learned about you" — the Learned Profile viewer/editor.
 * Lets the user see the durable facts LUCY built from reflection + feedback, and
 * delete any that are wrong (which is the negative-feedback signal).
 */
export function LearnedProfilePanel() {
  const [facts, setFacts] = useState<LearnedFactRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [reflecting, setReflecting] = useState(false);

  const load = useCallback(async () => {
    try {
      const db = await getDatabase();
      setFacts(await listLearnedFacts(db, 100));
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const remove = async (id: number) => {
    try {
      const db = await getDatabase();
      await deleteLearnedFact(db, id);
      setFacts((prev) => prev.filter((f) => f.id !== id));
    } catch { /* ignore */ }
  };

  const reflectNow = async () => {
    setReflecting(true);
    try {
      const db = await getDatabase();
      const { reflectOnUser } = await import('../processing/reflectOnUser');
      await reflectOnUser(db, true);
      await load();
    } catch { /* ignore */ } finally { setReflecting(false); }
  };

  return (
    <View style={s.wrap}>
      <Text style={s.hint}>
        Durable things LUCY has figured out about you, used to tailor its help. Delete anything that&apos;s wrong.
      </Text>

      {loading ? (
        <View style={{ paddingVertical: 16, alignItems: 'center' }}><ActivityIndicator color={LUCY_COLORS.primary} /></View>
      ) : facts.length === 0 ? (
        <Text style={s.empty}>Nothing learned yet — keep capturing, and LUCY will start noticing your patterns.</Text>
      ) : (
        facts.map((f) => (
          <View key={f.id} style={s.row}>
            <Text style={s.emoji}>{CATEGORY_EMOJI[f.category] ?? '•'}</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.statement}>{f.statement}</Text>
              <Text style={s.meta}>{f.category} · {f.confidence}{f.source === 'feedback' ? ' · you told me' : ''}</Text>
            </View>
            <TouchableOpacity onPress={() => void remove(f.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={s.remove}>✕</Text>
            </TouchableOpacity>
          </View>
        ))
      )}

      <TouchableOpacity style={[s.reflectBtn, reflecting && { opacity: 0.6 }]} onPress={() => void reflectNow()} disabled={reflecting}>
        <Text style={s.reflectText}>{reflecting ? 'Reflecting…' : '✦ Reflect now'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 8 },
  hint: { color: LUCY_COLORS.textMuted, fontSize: 13, lineHeight: 19 },
  empty: { color: LUCY_COLORS.textSubtle, fontSize: 13, fontStyle: 'italic', paddingVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: LUCY_COLORS.border },
  emoji: { fontSize: 16, width: 22, textAlign: 'center' },
  statement: { color: LUCY_COLORS.textDark, fontSize: 14, lineHeight: 19 },
  meta: { color: LUCY_COLORS.textSubtle, fontSize: 11, marginTop: 2, textTransform: 'capitalize' },
  remove: { color: LUCY_COLORS.textSubtle, fontSize: 16, fontWeight: '700', paddingHorizontal: 4 },
  reflectBtn: { marginTop: 12, paddingVertical: 11, alignItems: 'center', borderRadius: 12, borderWidth: 1, borderColor: LUCY_COLORS.primary, backgroundColor: LUCY_COLORS.primarySoft },
  reflectText: { color: LUCY_COLORS.primary, fontSize: 14, fontWeight: '800' },
});
