/**
 * CommitmentsSection — the "commitment guardian" surface for Focus Now.
 *
 * Shows promises the user MADE ("send the deck to Raghavendra by Thu") and things they're OWED
 * ("Priya will send me the file"), with deadlines, so they can keep or clear them at a glance.
 * The backend (db/commitments.ts + processing/commitmentGuardian.ts) does the detection and the
 * warm sentence; this component only loads, ranks by urgency, and renders.
 *
 * Design (matches StalenessReviewCard's accent-card vocabulary, elevated for "promises I must keep"):
 *   - Two soft subheaders group the list — "You owe" vs "Owed to you" — so direction reads instantly.
 *   - At-risk items sort to the top of each group (overdue + most-pressing first).
 *   - A left accent strip + urgency dot carry the deadline: overdue = rose, today/tomorrow = amber,
 *     later/undated = calm neutral. A small due chip ("today" / "2 days ago" / "Jun 24") repeats it.
 *   - The focal line is formatCommitmentLine(c) — LUCY's own warm phrasing, never re-built here.
 *   - Per card: a filled-soft "Done" + a quiet "Dismiss". No confirm; both re-load + bubble onChange.
 *   - Renders null when there's nothing open, so the section only appears when it's relevant.
 */
import { useCallback, useEffect, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { LUCY_COLORS } from '../config/colors';
import { FadeInUp, Stagger } from './Motion';
import { getDatabase } from '../db';
import {
  listAtRiskCommitments,
  listOpenCommitments,
  markCommitment,
  type CommitmentRow,
} from '../db/commitments';
import { formatCommitmentLine } from '../processing/commitmentGuardian';

const DAY_MS = 24 * 60 * 60 * 1000;

type Urgency = 'overdue' | 'soon' | 'calm';

const URGENCY_ACCENT: Record<Urgency, string> = {
  overdue: LUCY_COLORS.error,    // soft rose — a promise already past due
  soon: LUCY_COLORS.warning,     // amber — due today / tomorrow
  calm: LUCY_COLORS.textSubtle,  // neutral — later or open-ended
};

/** Urgency from a due date: overdue if past, "soon" if within ~36h, otherwise calm (incl. undated). */
function urgencyOf(dueISO: string | null, now: number): Urgency {
  if (!dueISO) return 'calm';
  const due = Date.parse(dueISO);
  if (!Number.isFinite(due)) return 'calm';
  if (due < now) return 'overdue';
  if (due <= now + 36 * 60 * 60 * 1000) return 'soon';
  return 'calm';
}

/** Compact due chip label: "today" / "tomorrow" / "2 days ago" / "Jun 24". Empty when undated. */
function dueChipLabel(dueISO: string | null, now: number): string {
  if (!dueISO) return '';
  const due = Date.parse(dueISO);
  if (!Number.isFinite(due)) return '';
  const startToday = new Date(now); startToday.setHours(0, 0, 0, 0);
  const startDue = new Date(due); startDue.setHours(0, 0, 0, 0);
  const diffDays = Math.round((startDue.getTime() - startToday.getTime()) / DAY_MS);
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'tomorrow';
  if (diffDays === -1) return 'yesterday';
  if (diffDays > 1) return `in ${diffDays} days`;
  if (diffDays < -1) return `${-diffDays} days ago`;
  return new Date(due).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

interface CommitmentsSectionProps {
  /** Bump to force a re-load (e.g. after the parent captures something). */
  refreshKey?: number;
  /** Called after a card is marked done/dismissed so the parent can refresh its own counts. */
  onChange?: () => void;
}

export function CommitmentsSection({ refreshKey, onChange }: CommitmentsSectionProps) {
  const [open, setOpen] = useState<CommitmentRow[]>([]);
  const [atRiskIds, setAtRiskIds] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    try {
      const db = await getDatabase();
      const [openRows, atRisk] = await Promise.all([
        listOpenCommitments(db),
        listAtRiskCommitments(db),
      ]);
      setOpen(openRows);
      setAtRiskIds(new Set(atRisk.map((c) => c.id)));
    } catch {
      // Non-critical surface — never let it break Focus Now.
      setOpen([]);
      setAtRiskIds(new Set());
    }
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const resolve = useCallback(async (id: number, status: 'done' | 'dismissed') => {
    // Optimistically drop the card so the tap feels instant, then persist + bubble up.
    setOpen((prev) => prev.filter((c) => c.id !== id));
    try {
      const db = await getDatabase();
      await markCommitment(db, id, status);
    } catch {
      // If the write fails, re-sync from the source of truth.
      void load();
    }
    onChange?.();
    void load();
  }, [load, onChange]);

  // The section only exists when it's relevant — no empty state.
  if (open.length === 0) return null;

  const now = Date.now();
  // At-risk first within each direction, then the data-layer order (soonest due, then undated).
  const rank = (c: CommitmentRow) => (atRiskIds.has(c.id) ? 0 : 1);
  const iOwe = open.filter((c) => c.direction === 'i-owe').sort((a, b) => rank(a) - rank(b));
  const owed = open.filter((c) => c.direction === 'owed-to-me').sort((a, b) => rank(a) - rank(b));

  return (
    <View style={s.section}>
      {/* Header mirrors NowView's SectionTitle (accent bar + title + count badge), tuned for this surface. */}
      <View style={s.headerRow}>
        <View style={s.headerAccent} />
        <Text style={s.headerTitle}>Commitments</Text>
        <View style={s.headerBadge}>
          <Text style={s.headerBadgeText}>{open.length}</Text>
        </View>
      </View>

      <Stagger step={50}>
        {iOwe.length > 0 ? <SubHeader key="owe-h" label="You owe" /> : null}
        {iOwe.map((c) => (
          <FadeInUp key={`owe-${c.id}`}>
            <CommitmentCard commitment={c} now={now} atRisk={atRiskIds.has(c.id)} onResolve={resolve} />
          </FadeInUp>
        ))}

        {owed.length > 0 ? <SubHeader key="owed-h" label="Owed to you" /> : null}
        {owed.map((c) => (
          <FadeInUp key={`owed-${c.id}`}>
            <CommitmentCard commitment={c} now={now} atRisk={atRiskIds.has(c.id)} onResolve={resolve} />
          </FadeInUp>
        ))}
      </Stagger>
    </View>
  );
}

function SubHeader({ label }: { label: string }) {
  return <Text style={s.subHeader}>{label.toUpperCase()}</Text>;
}

function CommitmentCard({
  commitment,
  now,
  atRisk,
  onResolve,
}: {
  commitment: CommitmentRow;
  now: number;
  atRisk: boolean;
  onResolve: (id: number, status: 'done' | 'dismissed') => void;
}) {
  const urgency = urgencyOf(commitment.due_at, now);
  const accent = URGENCY_ACCENT[urgency];
  const line = formatCommitmentLine(commitment, now);
  const chip = dueChipLabel(commitment.due_at, now);

  return (
    <View style={[s.card, { borderColor: `${accent}33`, borderLeftColor: accent }]}>
      <Text style={s.cardText}>
        <Text style={[s.dot, { color: accent }]}>{'● '}</Text>
        {line}
      </Text>

      <View style={s.metaRow}>
        {chip ? (
          <View style={[s.dueChip, { backgroundColor: `${accent}1F`, borderColor: `${accent}40` }]}>
            <Text style={[s.dueChipText, { color: accent }]}>{chip}</Text>
          </View>
        ) : (
          <View style={s.dueChip}>
            <Text style={s.dueChipMuted}>no deadline</Text>
          </View>
        )}
        {atRisk ? <Text style={[s.riskTag, { color: accent }]}>at risk</Text> : null}

        <View style={s.spacer} />

        <TouchableOpacity
          style={s.doneBtn}
          onPress={() => onResolve(commitment.id, 'done')}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Mark commitment done"
        >
          <Text style={s.doneBtnText}>Done</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={s.dismissBtn}
          onPress={() => onResolve(commitment.id, 'dismissed')}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Dismiss commitment"
        >
          <Text style={s.dismissBtnText}>Dismiss</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
// Plain objects (RN accepts these as style props) so per-card accent colours can be merged inline,
// matching the approach in StalenessReviewCard.

const s = {
  section: { marginBottom: 6 } as const,

  // Header — same shape as NowView's SectionTitle so it sits flush among the other sections.
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10, marginTop: 8 } as const,
  headerAccent: { width: 3, height: 16, borderRadius: 2, backgroundColor: LUCY_COLORS.primary } as const,
  headerTitle: { color: LUCY_COLORS.textDark, fontSize: 16, fontWeight: '800', flex: 1 } as const,
  headerBadge: { backgroundColor: LUCY_COLORS.primarySoft, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 } as const,
  headerBadgeText: { color: LUCY_COLORS.primaryGlow, fontSize: 11, fontWeight: '800' } as const,

  subHeader: {
    color: LUCY_COLORS.textSubtle,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.1,
    marginBottom: 8,
    marginTop: 2,
  } as const,

  // Card — surface step up + accent left strip (the StalenessReviewCard pattern).
  card: {
    backgroundColor: LUCY_COLORS.surfaceRaised,
    borderWidth: 1,
    borderLeftWidth: 3,
    borderRadius: 16,
    paddingVertical: 13,
    paddingHorizontal: 15,
    marginBottom: 10,
  } as const,
  dot: { fontSize: 11 } as const,
  cardText: {
    color: LUCY_COLORS.textDark,
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 22,
  } as const,

  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 } as const,
  spacer: { flex: 1 } as const,

  dueChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: LUCY_COLORS.border,
    backgroundColor: LUCY_COLORS.surface,
    paddingHorizontal: 9,
    paddingVertical: 3,
  } as const,
  dueChipText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.2 } as const,
  dueChipMuted: { fontSize: 11, fontWeight: '700', color: LUCY_COLORS.textSubtle } as const,

  riskTag: { fontSize: 10.5, fontWeight: '800', letterSpacing: 0.3, textTransform: 'uppercase' } as const,

  doneBtn: {
    backgroundColor: LUCY_COLORS.primarySoft,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
  } as const,
  doneBtnText: { color: LUCY_COLORS.primaryGlow, fontSize: 13, fontWeight: '700' } as const,

  dismissBtn: { paddingVertical: 8, paddingHorizontal: 8 } as const,
  dismissBtnText: { color: LUCY_COLORS.textSubtle, fontSize: 13, fontWeight: '600' } as const,
};
