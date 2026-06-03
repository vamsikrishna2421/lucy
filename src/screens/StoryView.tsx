/**
 * Story View — threads all captures about a person or topic into a
 * chronological narrative. The emotional hook of LUCY: "it remembers everything."
 */

import { useEffect, useRef, useState } from 'react';
import {
  Animated, Easing, Modal, Pressable, ScrollView,
  StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { LUCY_COLORS } from '../config/colors';
import { getDatabase } from '../db';
import type { CaptureRow } from '../db/captures';

export interface StorySubject {
  kind: 'person' | 'topic';
  name: string;
  emoji?: string;
  mentionCount?: number;
  lastMentioned?: string | null;
  pendingFollowUps?: number;
  typicalContext?: string | null;
}

interface StoryEntry {
  capture: CaptureRow;
  daysAgo: number;
  isFirst: boolean;
  isLast: boolean;
}

function formatRelativeDate(iso: string): string {
  const d = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} week${Math.floor(days / 7) === 1 ? '' : 's'} ago`;
  if (days < 365) return `${Math.floor(days / 30)} month${Math.floor(days / 30) === 1 ? '' : 's'} ago`;
  return `${Math.floor(days / 365)} year${Math.floor(days / 365) === 1 ? '' : 's'} ago`;
}

function StoryEntryCard({ entry, accentColor }: { entry: StoryEntry; accentColor: string }) {
  const [expanded, setExpanded] = useState(false);
  const c = entry.capture;
  const title = c.extracted_title ?? c.raw_transcript?.slice(0, 80) ?? '';
  const hasMore = c.structured_text && c.structured_text.length > 0;

  return (
    <View style={styles.entryWrap}>
      {/* Timeline spine */}
      <View style={styles.spineCol}>
        <View style={[styles.spineDot, { backgroundColor: entry.isFirst ? accentColor : LUCY_COLORS.border }]} />
        {!entry.isLast ? <View style={[styles.spineLine, { backgroundColor: LUCY_COLORS.border }]} /> : null}
      </View>

      {/* Card */}
      <TouchableOpacity
        style={styles.entryCard}
        onPress={() => setExpanded((v) => !v)}
        activeOpacity={0.8}
      >
        <Text style={styles.entryAge}>{formatRelativeDate(c.created_at)}</Text>
        <Text style={styles.entryTitle} numberOfLines={expanded ? undefined : 2}>{title}</Text>
        {expanded && c.raw_transcript && c.raw_transcript !== title ? (
          <Text style={styles.entryRaw}>{c.raw_transcript.slice(0, 300)}</Text>
        ) : null}
        {hasMore && !expanded ? (
          <Text style={styles.expandHint}>tap to expand</Text>
        ) : null}
      </TouchableOpacity>
    </View>
  );
}

export function StoryView({
  subject,
  visible,
  onClose,
}: {
  subject: StorySubject | null;
  visible: boolean;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<StoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const slideAnim = useRef(new Animated.Value(600)).current;

  const accentColor = subject?.kind === 'person' ? '#60A5FA' : LUCY_COLORS.primary;

  useEffect(() => {
    if (visible) {
      Animated.spring(slideAnim, { toValue: 0, friction: 22, tension: 200, useNativeDriver: true }).start();
      void loadStory();
    } else {
      Animated.timing(slideAnim, { toValue: 600, duration: 220, easing: Easing.in(Easing.quad), useNativeDriver: true }).start();
    }
  }, [visible, subject?.name]);

  const loadStory = async () => {
    if (!subject) return;
    setLoading(true);
    try {
      const db = await getDatabase();
      let rows: CaptureRow[] = [];
      if (subject.kind === 'person') {
        rows = await db.getAllAsync<CaptureRow>(
          `SELECT * FROM captures
           WHERE (raw_transcript LIKE ? OR extracted_title LIKE ?)
             AND processed = 1 AND archived_at IS NULL
           ORDER BY created_at DESC LIMIT 50`,
          `%${subject.name}%`, `%${subject.name}%`,
        );
      } else {
        // For topics: search by project/area name
        rows = await db.getAllAsync<CaptureRow>(
          `SELECT c.* FROM captures c
           JOIN extractions e ON e.capture_id = c.id
           WHERE (e.structured_json LIKE ? OR c.raw_transcript LIKE ?)
             AND c.processed = 1 AND c.archived_at IS NULL
           ORDER BY c.created_at DESC LIMIT 50`,
          `%"${subject.name}"%`, `%${subject.name}%`,
        );
      }
      const now = Date.now();
      setEntries(rows.map((capture, i) => ({
        capture,
        daysAgo: Math.floor((now - new Date(capture.created_at.includes('T') ? capture.created_at : `${capture.created_at.replace(' ', 'T')}Z`).getTime()) / 86400000),
        isFirst: i === 0,
        isLast: i === rows.length - 1,
      })));
    } catch { setEntries([]); }
    setLoading(false);
  };

  if (!subject) return null;

  // How long since last interaction
  const daysSince = subject.lastMentioned
    ? Math.floor((Date.now() - new Date(subject.lastMentioned.includes('T') ? subject.lastMentioned : `${subject.lastMentioned.replace(' ', 'T')}Z`).getTime()) / 86400000)
    : null;

  return (
    <Modal transparent animationType="none" visible={visible} onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Animated.View style={[styles.sheet, { transform: [{ translateY: slideAnim }] }]}>
          <Pressable>
            <View style={styles.handle} />

            {/* Header */}
            <View style={[styles.header, { borderBottomColor: `${accentColor}33` }]}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  {subject.emoji ? <Text style={{ fontSize: 22 }}>{subject.emoji}</Text> : null}
                  <Text style={styles.name}>{subject.name}</Text>
                </View>
                {/* Context + gap */}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                  {subject.mentionCount ? (
                    <View style={[styles.metaChip, { borderColor: `${accentColor}55` }]}>
                      <Text style={[styles.metaChipText, { color: accentColor }]}>
                        {subject.mentionCount} mention{subject.mentionCount !== 1 ? 's' : ''}
                      </Text>
                    </View>
                  ) : null}
                  {daysSince !== null ? (
                    <View style={[styles.metaChip, { borderColor: daysSince > 14 ? '#FB7185' + '55' : `${accentColor}55` }]}>
                      <Text style={[styles.metaChipText, { color: daysSince > 14 ? '#FB7185' : accentColor }]}>
                        {daysSince === 0 ? 'Today' : `${daysSince}d since last mention`}
                      </Text>
                    </View>
                  ) : null}
                  {subject.pendingFollowUps ? (
                    <View style={[styles.metaChip, { borderColor: 'rgba(245,158,11,0.55)' }]}>
                      <Text style={[styles.metaChipText, { color: '#F59E0B' }]}>
                        {subject.pendingFollowUps} follow-up{subject.pendingFollowUps !== 1 ? 's' : ''} pending
                      </Text>
                    </View>
                  ) : null}
                </View>
                {subject.typicalContext ? (
                  <Text style={styles.context} numberOfLines={2}>{subject.typicalContext}</Text>
                ) : null}
              </View>
              <TouchableOpacity onPress={onClose} style={styles.doneBtn}>
                <Text style={styles.doneBtnText}>Done</Text>
              </TouchableOpacity>
            </View>

            {/* Story timeline */}
            <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
              {loading ? (
                <View style={{ padding: 32, alignItems: 'center' }}>
                  <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 14 }}>Building story…</Text>
                </View>
              ) : entries.length === 0 ? (
                <View style={{ padding: 32, alignItems: 'center', gap: 10 }}>
                  <Text style={{ color: LUCY_COLORS.textDark, fontSize: 16, fontWeight: '700' }}>No story yet</Text>
                  <Text style={{ color: LUCY_COLORS.textMuted, fontSize: 14, textAlign: 'center', lineHeight: 21 }}>
                    Captures mentioning {subject.name} will appear here as a narrative timeline.
                  </Text>
                </View>
              ) : (
                <View style={styles.timeline}>
                  <Text style={styles.timelineLabel}>
                    {entries.length} moment{entries.length !== 1 ? 's' : ''} · most recent first
                  </Text>
                  {entries.map((entry) => (
                    <StoryEntryCard key={entry.capture.id} entry={entry} accentColor={accentColor} />
                  ))}
                </View>
              )}
              <View style={{ height: 40 }} />
            </ScrollView>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: LUCY_COLORS.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderTopWidth: 1, borderColor: LUCY_COLORS.border, maxHeight: '92%',
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.35, shadowRadius: 16, elevation: 12,
  },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: LUCY_COLORS.border, alignSelf: 'center', marginTop: 10, marginBottom: 4 },
  header: { padding: 20, paddingTop: 12, flexDirection: 'row', alignItems: 'flex-start', borderBottomWidth: 1, gap: 12 },
  name: { color: LUCY_COLORS.textDark, fontSize: 22, fontWeight: '800', letterSpacing: -0.4 },
  metaChip: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  metaChipText: { fontSize: 11, fontWeight: '700' },
  context: { color: LUCY_COLORS.textMuted, fontSize: 13, lineHeight: 18, marginTop: 6, fontStyle: 'italic' },
  doneBtn: { paddingLeft: 12, paddingTop: 4 },
  doneBtnText: { color: LUCY_COLORS.primary, fontSize: 15, fontWeight: '700' },
  scroll: { flex: 1 },
  timeline: { paddingHorizontal: 16, paddingTop: 14 },
  timelineLabel: { color: LUCY_COLORS.textSubtle, fontSize: 10, fontWeight: '800', letterSpacing: 1.4, marginBottom: 14, textTransform: 'uppercase' },
  // Spine
  entryWrap: { flexDirection: 'row', gap: 12, marginBottom: 2 },
  spineCol: { width: 18, alignItems: 'center', paddingTop: 4 },
  spineDot: { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  spineLine: { width: 2, flex: 1, marginTop: 4, marginBottom: -4 },
  // Entry card
  entryCard: { flex: 1, backgroundColor: LUCY_COLORS.surfaceRaised, borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: LUCY_COLORS.border, borderTopColor: '#3A3028', gap: 4 },
  entryAge: { color: LUCY_COLORS.textSubtle, fontSize: 10, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  entryTitle: { color: LUCY_COLORS.textDark, fontSize: 14, fontWeight: '600', lineHeight: 20 },
  entryRaw: { color: LUCY_COLORS.textMuted, fontSize: 13, lineHeight: 18, marginTop: 4 },
  expandHint: { color: LUCY_COLORS.textSubtle, fontSize: 11, marginTop: 2 },
});
