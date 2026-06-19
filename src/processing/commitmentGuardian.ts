/**
 * Commitment guardian — surfacing + chasing. Turns stored commitments (db/commitments.ts) into human
 * lines for the `commitments` tool + morning brief, and proactively nudges the user about an at-risk
 * promise (one per run, so it never spams). Copy is warm + human, never robotic metadata.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import type { CommitmentRow } from '../db/commitments';
import {
  listAtRiskCommitments,
  listOpenCommitments,
  markCommitmentNudged,
} from '../db/commitments';
import { sendGuardianNotification } from './notifications';

const DAY_MS = 24 * 60 * 60 * 1000;

function isPast(dueISO: string | null, now: number): boolean {
  const due = Date.parse(dueISO ?? '');
  return Number.isFinite(due) && due < now;
}

/** "today" / "tomorrow" / "yesterday" / "in 3 days" / "3 days ago" / "Jun 24". */
function relativeDue(dueISO: string | null, now: number): string {
  if (!dueISO) return '';
  const due = Date.parse(dueISO);
  if (!Number.isFinite(due)) return '';
  const startToday = new Date(now); startToday.setHours(0, 0, 0, 0);
  const startDue = new Date(due); startDue.setHours(0, 0, 0, 0);
  const diffDays = Math.round((startDue.getTime() - startToday.getTime()) / DAY_MS);
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'tomorrow';
  if (diffDays === -1) return 'yesterday';
  if (diffDays > 1 && diffDays <= 7) return `in ${diffDays} days`;
  if (diffDays < -1 && diffDays >= -7) return `${-diffDays} days ago`;
  return new Date(due).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

type CommitmentLike = Pick<CommitmentRow, 'action' | 'counterparty' | 'due_at' | 'direction'>;

/** One warm, human sentence for a commitment. */
export function formatCommitmentLine(c: CommitmentLike, now = Date.now()): string {
  const rel = relativeDue(c.due_at, now);
  const overdue = isPast(c.due_at, now);
  const action = (c.action || '').trim() || 'follow up';

  if (c.direction === 'i-owe') {
    const who = c.counterparty ? ` to ${c.counterparty}` : '';
    if (!rel) return `You said you'd ${action}${who}.`;
    return overdue
      ? `You promised to ${action}${who} — that was due ${rel}.`
      : `You said you'd ${action}${who} by ${rel}.`;
  }

  // owed-to-me
  const who = c.counterparty ?? 'someone';
  const act = action.replace(/^waiting for\s*/i, '').trim();
  const base = act ? `${who} to ${act}` : who;
  if (!rel) return `You're waiting on ${base}.`;
  return overdue
    ? `You're still waiting on ${base} — that was due ${rel}.`
    : `You're waiting on ${base} (due ${rel}).`;
}

/** Prose + data for the `commitments` Ask tool. */
export async function buildCommitmentSummary(db: SQLiteDatabase, now = Date.now()): Promise<{ prose: string; data: { commitments: CommitmentRow[]; atRisk: CommitmentRow[] } }> {
  const open = await listOpenCommitments(db);
  if (open.length === 0) {
    return { prose: "You don't have any open promises I'm tracking right now.", data: { commitments: [], atRisk: [] } };
  }
  const atRisk = await listAtRiskCommitments(db, now);
  const iOwe = open.filter((c) => c.direction === 'i-owe');
  const owed = open.filter((c) => c.direction === 'owed-to-me');

  const parts: string[] = [];
  if (atRisk.length > 0) {
    parts.push(formatCommitmentLine(atRisk[0], now));
    if (atRisk.length > 1) parts.push(`(${atRisk.length - 1} more ${atRisk.length - 1 === 1 ? 'is' : 'are'} due soon too.)`);
  }
  if (iOwe.length > 0) {
    const lead = atRisk.length > 0 ? 'You also owe' : 'You owe';
    const sample = iOwe.filter((c) => !atRisk.some((a) => a.id === c.id)).slice(0, 2).map((c) => formatCommitmentLine(c, now));
    if (sample.length > 0) parts.push(`${lead}: ${sample.join(' ')}`);
    else if (atRisk.length === 0) parts.push(`${lead} ${iOwe.length} thing${iOwe.length === 1 ? '' : 's'}.`);
  }
  if (owed.length > 0) {
    const sample = owed.filter((c) => !atRisk.some((a) => a.id === c.id)).slice(0, 2).map((c) => formatCommitmentLine(c, now));
    if (sample.length > 0) parts.push(sample.join(' '));
  }
  return { prose: parts.join(' '), data: { commitments: open, atRisk } };
}

/** Proactively nudge about the single most-pressing at-risk promise that hasn't been nudged in the
 *  last ~20h. One notification per run so it never piles up. Returns true if a nudge was sent. */
export async function checkCommitmentNudges(db: SQLiteDatabase, now = Date.now()): Promise<boolean> {
  const atRisk = await listAtRiskCommitments(db, now);
  const candidate = atRisk.find((c) => {
    if (!c.nudged_at) return true;
    const last = Date.parse(c.nudged_at);
    return !Number.isFinite(last) || last < now - 20 * 60 * 60 * 1000;
  });
  if (!candidate) return false;

  const line = formatCommitmentLine(candidate, now);
  const tail = candidate.direction === 'i-owe' ? ' Want me to remind you, or mark it done?' : ' Want to give them a nudge?';
  try {
    await sendGuardianNotification(line + tail, { kind: 'commitment' });
    await markCommitmentNudged(db, candidate.id);
    return true;
  } catch {
    return false;
  }
}
