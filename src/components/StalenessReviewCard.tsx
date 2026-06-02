/**
 * StalenessReviewCard
 *
 * Renders a single in-line review prompt for one StalenessReview item.
 * Used inside Focus Now to present staleness confirmations without
 * interrupting the user with a modal.
 *
 * Variants:
 *   reminder_expired  — "This reminder fired X ago. Keep or archive?"
 *   todo_outdated     — "Scheduled for [date] — done? Keep or archive?"
 *   todo_duplicate    — "These two todos look the same. Merge or keep both?"
 *   context_overflow  — Rendered by ContextBatchCard (separate component below)
 */

import { useState } from 'react';
import { TouchableOpacity, View, Text, TextInput } from 'react-native';
import { LUCY_COLORS } from '../config/colors';
import { getDatabase } from '../db';
import { archiveReminder } from '../db/reminders';
import { archiveTodo, mergeDuplicateTodos } from '../db/todos';
import { dismissReview, type StalenessReview } from '../processing/stalenessEngine';
import {
  dismissAllLowPriorityContext,
  getContextBatch,
  type ContextBatch,
} from '../processing/stalenessEngine';
import { answerContextRequest, dismissContextRequest } from '../db/contextRequests';
import { organizeMemory } from '../processing/organizer';

// ─── Shared accent colours ────────────────────────────────────────────────────

const ACCENT_EXPIRED  = '#F59E0B'; // amber
const ACCENT_OUTDATED = '#FB7185'; // rose
const ACCENT_DUP      = '#818CF8'; // indigo
const ACCENT_OVERFLOW = '#60A5FA'; // blue

function relativeTime(isoOrSqlite: string): string {
  const ms = Date.now() - new Date(
    isoOrSqlite.includes('T') ? isoOrSqlite : `${isoOrSqlite.replace(' ', 'T')}Z`,
  ).getTime();
  const h = Math.floor(ms / 3600_000);
  const d = Math.floor(ms / 86_400_000);
  if (d >= 2) return `${d} days ago`;
  if (d === 1) return 'yesterday';
  if (h >= 1) return `${h}h ago`;
  const m = Math.floor(ms / 60_000);
  return `${Math.max(1, m)}m ago`;
}

function scheduledLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

// ─── Reminder expired card ────────────────────────────────────────────────────

function ReminderExpiredCard({
  review,
  onDone,
}: {
  review: StalenessReview;
  onDone: () => void;
}) {
  const ageLabel = review.scheduled_for ? `fired ${relativeTime(review.scheduled_for)}` : 'no scheduled time';

  const handleArchive = async () => {
    const db = await getDatabase();
    await archiveReminder(db, review.item_id, 'user confirmed: reminder no longer needed');
    await dismissReview(db, review.id);
    onDone();
  };

  const handleKeep = async () => {
    const db = await getDatabase();
    await dismissReview(db, review.id);
    onDone();
  };

  return (
    <View style={card(ACCENT_EXPIRED)}>
      <Text style={eyebrow(ACCENT_EXPIRED)}>REMINDER EXPIRED</Text>
      <Text style={itemText}>{review.item_text}</Text>
      <Text style={subText}>{ageLabel}</Text>
      <View style={buttonRow}>
        <TouchableOpacity style={destructiveBtn} onPress={() => void handleArchive()}>
          <Text style={destructiveBtnText}>Archive it</Text>
        </TouchableOpacity>
        <TouchableOpacity style={ghostBtn} onPress={() => void handleKeep()}>
          <Text style={ghostBtnText}>Keep</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Todo outdated card ───────────────────────────────────────────────────────

function TodoOutdatedCard({
  review,
  onDone,
}: {
  review: StalenessReview;
  onDone: () => void;
}) {
  const scheduledLabel_ = review.scheduled_for ? scheduledLabel(review.scheduled_for) : 'a past time';

  const handleArchive = async () => {
    const db = await getDatabase();
    await archiveTodo(db, review.item_id, 'user confirmed: scheduled date has passed');
    await dismissReview(db, review.id);
    onDone();
  };

  const handleKeep = async () => {
    const db = await getDatabase();
    await dismissReview(db, review.id);
    onDone();
  };

  return (
    <View style={card(ACCENT_OUTDATED)}>
      <Text style={eyebrow(ACCENT_OUTDATED)}>SCHEDULED DATE PASSED</Text>
      <Text style={itemText}>{review.item_text}</Text>
      <Text style={subText}>Was for {scheduledLabel_}</Text>
      <View style={buttonRow}>
        <TouchableOpacity style={destructiveBtn} onPress={() => void handleArchive()}>
          <Text style={destructiveBtnText}>Archive it</Text>
        </TouchableOpacity>
        <TouchableOpacity style={ghostBtn} onPress={() => void handleKeep()}>
          <Text style={ghostBtnText}>Still relevant</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Duplicate todo card ──────────────────────────────────────────────────────

function DuplicateTodoCard({
  review,
  onDone,
}: {
  review: StalenessReview;
  onDone: () => void;
}) {
  const [mergeText, setMergeText] = useState('');
  const [editing, setEditing] = useState(false);

  const handleMerge = async () => {
    const db = await getDatabase();
    const finalText = mergeText.trim() || review.item_text;
    // Keep the primary todo (item_id), discard the related one (related_id)
    await mergeDuplicateTodos(db, review.item_id, review.related_id!, finalText);
    await dismissReview(db, review.id);
    onDone();
  };

  const handleKeepBoth = async () => {
    const db = await getDatabase();
    await dismissReview(db, review.id);
    onDone();
  };

  return (
    <View style={card(ACCENT_DUP)}>
      <Text style={eyebrow(ACCENT_DUP)}>POSSIBLE DUPLICATE</Text>
      <View style={{ gap: 6, marginVertical: 6 }}>
        <View style={dupItem}>
          <Text style={dupBullet}>A</Text>
          <Text style={[itemText, { flex: 1 }]} numberOfLines={2}>{review.item_text}</Text>
        </View>
        <View style={dupItem}>
          <Text style={dupBullet}>B</Text>
          <Text style={[itemText, { flex: 1 }]} numberOfLines={2}>{review.related_text ?? ''}</Text>
        </View>
      </View>
      {editing ? (
        <TextInput
          style={mergeInput}
          value={mergeText}
          onChangeText={setMergeText}
          placeholder="Edit merged text (leave blank to keep A)"
          placeholderTextColor={LUCY_COLORS.textSubtle}
          autoFocus
          multiline
        />
      ) : null}
      <View style={buttonRow}>
        <TouchableOpacity
          style={primaryBtn}
          onPress={() => {
            if (!editing) { setEditing(true); return; }
            void handleMerge();
          }}
        >
          <Text style={primaryBtnText}>{editing ? 'Confirm merge' : 'Merge'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={ghostBtn} onPress={() => void handleKeepBoth()}>
          <Text style={ghostBtnText}>Keep both</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Context batch card (overflow) ───────────────────────────────────────────

export function ContextBatchCard({
  batch,
  onDone,
}: {
  batch: ContextBatch;
  onDone: () => void;
}) {
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());

  const visible = batch.visible.filter((r) => !dismissed.has(r.id));

  const handleAnswer = async (id: number) => {
    const answer = (answers[id] ?? '').trim();
    if (!answer) return;
    const db = await getDatabase();
    await answerContextRequest(db, id, answer);
    await organizeMemory(db, 'clarification');
    setAnswers((prev) => ({ ...prev, [id]: '' }));
    setDismissed((prev) => new Set(prev).add(id));
  };

  const handleSkip = async (id: number) => {
    const db = await getDatabase();
    await dismissContextRequest(db, id);
    setDismissed((prev) => new Set(prev).add(id));
  };

  const handleDismissAllLow = async () => {
    const db = await getDatabase();
    await dismissAllLowPriorityContext(db);
    onDone();
  };

  if (visible.length === 0) {
    onDone();
    return null;
  }

  const overflowCount = batch.total - batch.visible.length;

  return (
    <View style={card(ACCENT_OVERFLOW)}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <Text style={eyebrow(ACCENT_OVERFLOW)}>NEEDS CONTEXT</Text>
        <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 11 }}>
          {batch.visible.length} of {batch.total}
        </Text>
      </View>
      <Text style={subText}>Answer these when you have a moment — LUCY keeps your original unchanged.</Text>
      {visible.map((req) => (
        <View key={req.id} style={{ marginTop: 12, borderTopWidth: 1, borderTopColor: LUCY_COLORS.border, paddingTop: 10 }}>
          <Text style={[itemText, { marginBottom: 4 }]}>{req.question}</Text>
          {req.snippet ? (
            <Text style={[subText, { fontStyle: 'italic', marginBottom: 6 }]}>You said: "{req.snippet?.slice(0, 80)}"</Text>
          ) : null}
          <TextInput
            style={mergeInput}
            value={answers[req.id] ?? ''}
            onChangeText={(v) => setAnswers((prev) => ({ ...prev, [req.id]: v }))}
            placeholder="Your answer..."
            placeholderTextColor={LUCY_COLORS.textSubtle}
            multiline
          />
          <View style={[buttonRow, { marginTop: 6 }]}>
            <TouchableOpacity
              style={[primaryBtn, !(answers[req.id] ?? '').trim() && { opacity: 0.4 }]}
              disabled={!(answers[req.id] ?? '').trim()}
              onPress={() => void handleAnswer(req.id)}
            >
              <Text style={primaryBtnText}>Tell LUCY</Text>
            </TouchableOpacity>
            <TouchableOpacity style={ghostBtn} onPress={() => void handleSkip(req.id)}>
              <Text style={ghostBtnText}>Skip</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}
      {overflowCount > 0 || batch.lowPriorityCount > 0 ? (
        <View style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          {overflowCount > 0 ? (
            <Text style={{ color: LUCY_COLORS.textSubtle, fontSize: 12 }}>
              +{overflowCount} more waiting
            </Text>
          ) : <View />}
          {batch.lowPriorityCount > 0 ? (
            <TouchableOpacity onPress={() => void handleDismissAllLow()}>
              <Text style={{ color: ACCENT_OVERFLOW, fontSize: 12, fontWeight: '700' }}>
                Clear {batch.lowPriorityCount} low-priority
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

// ─── Router ───────────────────────────────────────────────────────────────────

export function StalenessReviewCard({
  review,
  onDone,
}: {
  review: StalenessReview;
  onDone: () => void;
}) {
  switch (review.kind) {
    case 'reminder_expired':
      return <ReminderExpiredCard review={review} onDone={onDone} />;
    case 'todo_outdated':
      return <TodoOutdatedCard review={review} onDone={onDone} />;
    case 'todo_duplicate':
      return <DuplicateTodoCard review={review} onDone={onDone} />;
    default:
      return null; // context_overflow is handled by ContextBatchCard separately
  }
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function card(accent: string) {
  return {
    backgroundColor: LUCY_COLORS.surface,
    borderWidth: 1,
    borderColor: `${accent}44`,
    borderLeftWidth: 3,
    borderLeftColor: accent,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  } as const;
}

function eyebrow(accent: string) {
  return {
    color: accent,
    fontSize: 9,
    fontWeight: '800' as const,
    letterSpacing: 1.2,
    marginBottom: 6,
  };
}

const itemText = {
  color: LUCY_COLORS.textDark,
  fontSize: 14,
  fontWeight: '600' as const,
  lineHeight: 20,
} as const;

const subText = {
  color: LUCY_COLORS.textMuted,
  fontSize: 12,
  marginTop: 2,
  lineHeight: 17,
} as const;

const buttonRow = {
  flexDirection: 'row' as const,
  gap: 8,
  marginTop: 10,
  alignItems: 'center' as const,
};

const destructiveBtn = {
  backgroundColor: '#3D1515',
  borderRadius: 10,
  paddingVertical: 9,
  paddingHorizontal: 14,
} as const;

const destructiveBtnText = {
  color: '#FB7185',
  fontSize: 13,
  fontWeight: '700' as const,
} as const;

const ghostBtn = {
  paddingVertical: 9,
  paddingHorizontal: 10,
} as const;

const ghostBtnText = {
  color: LUCY_COLORS.textSubtle,
  fontSize: 13,
} as const;

const primaryBtn = {
  backgroundColor: LUCY_COLORS.primarySoft,
  borderRadius: 10,
  paddingVertical: 9,
  paddingHorizontal: 14,
} as const;

const primaryBtnText = {
  color: LUCY_COLORS.primary,
  fontSize: 13,
  fontWeight: '700' as const,
} as const;

const dupItem = {
  flexDirection: 'row' as const,
  alignItems: 'flex-start' as const,
  gap: 8,
};

const dupBullet = {
  color: ACCENT_DUP,
  fontSize: 11,
  fontWeight: '800' as const,
  marginTop: 2,
  width: 14,
} as const;

const mergeInput = {
  backgroundColor: LUCY_COLORS.surfaceRaised,
  borderRadius: 10,
  padding: 10,
  color: LUCY_COLORS.textDark,
  fontSize: 13,
  marginTop: 6,
  minHeight: 44,
} as const;
