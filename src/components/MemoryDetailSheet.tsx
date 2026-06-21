import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { LUCY_COLORS, LUCY_SHADOWS } from '../config/colors';
import { getDatabase } from '../db';
import { ShieldedText, type ProtectedValueLite } from './ShieldedText';

interface CaptureDetail {
  id: number;
  created_at: string;
  raw_transcript: string;
  extracted_title: string | null;
  structured_text: string | null;
  protected_values: string | null;
  source_image_path: string | null;
}

/**
 * Memory detail — shown when a capture is tapped inside a Brain Galaxy topic.
 * Previously a no-op (blank). Now shows the memory's title, summary, and full text,
 * an auto-generated LUCY insight, and an inline "Ask LUCY about this memory" box.
 */
export function MemoryDetailSheet({ captureId, visible, onClose }: { captureId: number | null; visible: boolean; onClose: () => void }) {
  const [detail, setDetail] = useState<CaptureDetail | null>(null);
  const [insight, setInsight] = useState<string>('');
  const [insightLoading, setInsightLoading] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [asking, setAsking] = useState(false);
  const [viewer, setViewer] = useState(false);

  useEffect(() => {
    if (!visible || captureId == null) return;
    setDetail(null); setInsight(''); setAnswer(''); setQuestion('');
    void (async () => {
      try {
        const db = await getDatabase();
        const row = await db.getFirstAsync<CaptureDetail>(
          'SELECT id, created_at, raw_transcript, extracted_title, structured_text, protected_values, source_image_path FROM captures WHERE id = ?',
          captureId,
        );
        setDetail(row ?? null);
        if (row) void generateInsight(row);
      } catch { /* ignore */ }
    })();
  }, [visible, captureId]);

  const generateInsight = async (row: CaptureDetail) => {
    setInsightLoading(true);
    try {
      const { resolveRemoteAvailability, AIProvider } = await import('../ai/provider');
      const { available } = await resolveRemoteAvailability();
      if (!available) { setInsight(''); return; }
      const sys = 'You are LUCY, a personal second-brain. In 2-3 sentences, give a sharp, useful insight about this single memory — what it reveals, a connection, or a next step. Plain text, warm, specific. No preamble.';
      const text = row.structured_text || row.raw_transcript || '';
      // AIProvider.prompt shields passwords/names before the cloud call and restores them after.
      const out = await AIProvider.prompt(sys, text.slice(0, 1500));
      setInsight(out.trim());
    } catch { setInsight(''); } finally { setInsightLoading(false); }
  };

  const ask = async () => {
    const q = question.trim();
    if (!q || asking || !detail) return;
    setAsking(true); setAnswer('');
    try {
      const { resolveRemoteAvailability, AIProvider } = await import('../ai/provider');
      const { available } = await resolveRemoteAvailability();
      if (!available) { setAnswer('Enable Remote Intelligence in Settings to ask about memories.'); return; }
      const sys = 'You are LUCY answering a question about ONE specific memory the user captured. Use only this memory plus general knowledge. Be concise, warm, plain text.';
      const input = `MEMORY:\n${(detail.structured_text || detail.raw_transcript || '').slice(0, 1500)}\n\nQUESTION: ${q}`;
      // Shielded: real passwords/names never leave the device; the answer restores them locally.
      const out = await AIProvider.prompt(sys, input);
      setAnswer(out.trim());
    } catch { setAnswer('I had trouble answering that.'); } finally { setAsking(false); }
  };

  const dateStr = detail ? new Date(detail.created_at.includes('T') ? detail.created_at : `${detail.created_at.replace(' ', 'T')}Z`).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';

  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={s.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[s.sheet, { height: '88%' }]}>
          <View style={s.header}>
            <Text style={s.kicker}>MEMORY</Text>
            <TouchableOpacity onPress={onClose}><Text style={s.close}>Done</Text></TouchableOpacity>
          </View>
          {!detail ? (
            <View style={{ padding: 40, alignItems: 'center' }}><ActivityIndicator color={LUCY_COLORS.primary} /></View>
          ) : (
            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {(() => {
                let protectedValues: ProtectedValueLite[] = [];
                try { protectedValues = detail.protected_values ? JSON.parse(detail.protected_values) as ProtectedValueLite[] : []; } catch { /* ignore */ }
                const body = detail.structured_text || detail.raw_transcript || 'No content.';
                return (
                  <>
                    <ShieldedText style={s.title} text={detail.extracted_title || 'Untitled memory'} protectedValues={protectedValues} />
                    <Text style={s.date}>{dateStr}</Text>
                    {protectedValues.length > 0 ? (
                      <View style={s.shieldNote}>
                        <Text style={s.shieldNoteText}>🛡 Passwords & names were kept private from the cloud — LUCY processed placeholders, not your real values.</Text>
                      </View>
                    ) : null}

                    {detail.source_image_path ? (
                      <TouchableOpacity style={s.viewOriginalBtn} onPress={() => setViewer(true)}>
                        <Text style={s.viewOriginalText}>🖼  View original photo</Text>
                      </TouchableOpacity>
                    ) : null}

                    <Text style={s.sectionLabel}>SUMMARY</Text>
                    <ShieldedText style={s.body} text={body} protectedValues={protectedValues} />

                    {/* When values were shielded, always show the original note so the user
                        can see their real password/name (highlighted) — it lives on-device. */}
                    {protectedValues.length > 0 && detail.raw_transcript && detail.raw_transcript.trim() !== body.trim() ? (
                      <>
                        <Text style={s.sectionLabel}>ORIGINAL NOTE (on this device)</Text>
                        <ShieldedText style={s.body} text={detail.raw_transcript} protectedValues={protectedValues} />
                      </>
                    ) : null}
                  </>
                );
              })()}

              <Text style={s.sectionLabel}>✦ LUCY'S INSIGHT</Text>
              {insightLoading ? (
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', paddingVertical: 6 }}>
                  <ActivityIndicator color={LUCY_COLORS.primary} size="small" />
                  <Text style={s.muted}>Thinking…</Text>
                </View>
              ) : insight ? (
                <View style={s.insightCard}><Text style={s.insightText}>{insight}</Text></View>
              ) : (
                <Text style={s.muted}>Enable Remote Intelligence in Settings for insights.</Text>
              )}

              <Text style={s.sectionLabel}>ASK ABOUT THIS MEMORY</Text>
              <View style={s.askRow}>
                <TextInput
                  style={s.askInput}
                  placeholder="e.g. what should I do next?"
                  placeholderTextColor={LUCY_COLORS.textSubtle}
                  value={question}
                  onChangeText={setQuestion}
                  returnKeyType="send"
                  onSubmitEditing={() => void ask()}
                />
                <TouchableOpacity style={[s.askBtn, (!question.trim() || asking) && { opacity: 0.4 }]} disabled={!question.trim() || asking} onPress={() => void ask()}>
                  <Text style={s.askBtnText}>{asking ? '…' : 'Ask'}</Text>
                </TouchableOpacity>
              </View>
              {answer ? <View style={s.answerCard}><Text style={s.answerLabel}>LUCY</Text><Text style={s.answerText}>{answer}</Text></View> : null}
              <View style={{ height: 32 }} />
            </ScrollView>
          )}
        </View>
      </View>
      {/* Original source photo viewer */}
      <Modal visible={viewer} transparent animationType="fade" onRequestClose={() => setViewer(false)}>
        <Pressable style={s.viewerBackdrop} onPress={() => setViewer(false)}>
          {detail?.source_image_path ? <Image source={{ uri: detail.source_image_path }} style={s.viewerImg} resizeMode="contain" /> : null}
          <Text style={s.viewerHint}>Tap to close · original photo</Text>
        </Pressable>
      </Modal>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(20,22,40,0.40)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: LUCY_COLORS.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderTopColor: LUCY_COLORS.border, padding: 20, ...LUCY_SHADOWS.lg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  kicker: { color: LUCY_COLORS.primaryGlow, fontSize: 11, fontWeight: '800', letterSpacing: 1.5 },
  close: { color: LUCY_COLORS.primary, fontSize: 15, fontWeight: '700' },
  title: { color: LUCY_COLORS.textDark, fontSize: 20, fontWeight: '800', lineHeight: 27 },
  date: { color: LUCY_COLORS.textSubtle, fontSize: 12, marginTop: 4 },
  sectionLabel: { color: LUCY_COLORS.textSubtle, fontSize: 10, fontWeight: '800', letterSpacing: 1.2, marginTop: 20, marginBottom: 8 },
  body: { color: LUCY_COLORS.textMuted, fontSize: 14, lineHeight: 21 },
  viewOriginalBtn: { marginTop: 14, alignSelf: 'flex-start', backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 12, paddingVertical: 9, paddingHorizontal: 14, borderWidth: 1, borderColor: LUCY_COLORS.border },
  viewOriginalText: { color: LUCY_COLORS.primaryGlow, fontWeight: '700', fontSize: 13 },
  viewerBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', alignItems: 'center', justifyContent: 'center' },
  viewerImg: { width: '100%', height: '82%' },
  viewerHint: { color: 'rgba(255,255,255,0.6)', fontSize: 13, marginTop: 14 },
  shieldNote: { backgroundColor: LUCY_COLORS.success + '18', borderRadius: 10, padding: 10, marginTop: 12, borderWidth: 1, borderColor: LUCY_COLORS.success + '33' },
  shieldNoteText: { color: LUCY_COLORS.success, fontSize: 12, fontWeight: '600', lineHeight: 17 },
  muted: { color: LUCY_COLORS.textSubtle, fontSize: 13, fontStyle: 'italic' },
  insightCard: { backgroundColor: LUCY_COLORS.primarySoft, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: LUCY_COLORS.primaryLine },
  insightText: { color: LUCY_COLORS.textDark, fontSize: 14, lineHeight: 21 },
  askRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  askInput: { flex: 1, backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, color: LUCY_COLORS.textDark, fontSize: 14, borderWidth: 1, borderColor: LUCY_COLORS.border },
  askBtn: { backgroundColor: LUCY_COLORS.primary, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 11 },
  askBtnText: { color: LUCY_COLORS.white, fontSize: 14, fontWeight: '700' },
  answerCard: { backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 12, padding: 14, marginTop: 12, gap: 6 },
  answerLabel: { color: LUCY_COLORS.primaryGlow, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  answerText: { color: LUCY_COLORS.textDark, fontSize: 14, lineHeight: 21 },
});
