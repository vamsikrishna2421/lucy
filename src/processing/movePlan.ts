/**
 * Move / lease autopilot (Vamsi top-6 #5) — turns the pure detector (moveLease.ts) into a real feature:
 * when a capture signals a move/lease, LUCY offers (propose-and-confirm — never auto) to spin up a
 * "House move" project seeded with the standard relocation checklist, and to CHASE the highest-stakes,
 * most-forgotten date — the notice deadline (lease end minus the notice period) — as a real reminder.
 *
 * Detection + date math are tested in moveLease.ts; this module is the DB orchestration (project + todos
 * + reminder) and the propose/dismiss plumbing the Projects tab surfaces.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import type { CaptureRow } from '../db/captures';
import type { ExtractionResult } from '../types/extraction';
import { createProject, listProjects } from '../db/projects';
import { detectMoveLease, noticeDeadline, relocationPlan, RELOCATION_CHECKLIST, type MoveLeaseSignal } from './moveLease';
import { getSetting, setSetting } from '../db/settings';

const SIGNAL_KEY = 'move_plan_signal';
const DISMISSED_KEY = 'move_plan_dismissed';
const PROJECT_NAME = 'House move';

/** What we persist when a move is detected, so the Projects tab can offer to set up the plan later. */
export interface StoredMoveSignal {
  kind: MoveLeaseSignal['kind'];
  noticeDays: number | null;
  dates: MoveLeaseSignal['dates'];
  sample: string;
  captureId: number | null;
  detectedAt: string;
}

async function hasMoveProject(db: SQLiteDatabase): Promise<boolean> {
  const projects = await listProjects(db);
  return projects.some((p) => p.name.trim().toLowerCase() === PROJECT_NAME.toLowerCase());
}

/** Called during extraction: if this capture signals a move/lease (and the user hasn't already got a move
 *  project or dismissed the offer), remember the signal so the Projects tab can propose a move plan.
 *  Never creates anything — purely a flag. */
export async function maybeFlagMoveSignal(db: SQLiteDatabase, extraction: ExtractionResult, capture: CaptureRow): Promise<void> {
  const signal = detectMoveLease(capture.raw_transcript ?? '', Date.parse(capture.created_at ?? '') || Date.now());
  if (!signal) return;
  // Only offer on a STRONG signal (a date, a notice period, lease language, or an explicit move verb) —
  // not a casual "new place" — so the banner never feels like a false alarm.
  const strong = signal.kind === 'lease'
    || signal.noticeDays != null
    || signal.dates.length > 0
    || /\b(moving (?:out|in|to)|relocat(?:e|ing|ion)|move[- ]?out|move[- ]?in|shifting (?:to|house|homes?))\b/i.test(capture.raw_transcript ?? '');
  if (!strong) return;
  if (await getSetting(db, DISMISSED_KEY)) return; // user already said no
  if (await hasMoveProject(db)) return;            // already set up

  // Merge with any prior signal so we keep the best dates/notice we've seen across captures.
  let prior: StoredMoveSignal | null = null;
  try { const raw = await getSetting(db, SIGNAL_KEY); if (raw) prior = JSON.parse(raw) as StoredMoveSignal; } catch { /* ignore */ }
  const dates = [...(prior?.dates ?? []), ...signal.dates].filter((d) => d.dueISO);
  const stored: StoredMoveSignal = {
    kind: signal.kind === 'lease' || prior?.kind === 'lease' ? 'lease' : signal.kind,
    noticeDays: signal.noticeDays ?? prior?.noticeDays ?? null,
    dates: dedupeDates(dates),
    sample: (capture.raw_transcript ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) || prior?.sample || '',
    captureId: capture.id ?? prior?.captureId ?? null,
    detectedAt: new Date().toISOString(),
  };
  void extraction; // extraction not needed beyond capture text today; kept for future enrichment
  await setSetting(db, SIGNAL_KEY, JSON.stringify(stored));
}

function dedupeDates(dates: MoveLeaseSignal['dates']): MoveLeaseSignal['dates'] {
  const seen = new Set<string>();
  const out: MoveLeaseSignal['dates'] = [];
  for (const d of dates) {
    const key = `${d.label}|${d.dueISO}`;
    if (!seen.has(key)) { seen.add(key); out.push(d); }
  }
  return out;
}

/** The pending move offer for the Projects tab (null when there's nothing to offer). */
export async function getMoveSignal(db: SQLiteDatabase): Promise<StoredMoveSignal | null> {
  if (await getSetting(db, DISMISSED_KEY)) return null;
  if (await hasMoveProject(db)) return null;
  try { const raw = await getSetting(db, SIGNAL_KEY); return raw ? (JSON.parse(raw) as StoredMoveSignal) : null; } catch { return null; }
}

/** User said "not a move" — stop offering. */
export async function dismissMoveSignal(db: SQLiteDatabase): Promise<void> {
  await setSetting(db, DISMISSED_KEY, '1');
  await setSetting(db, SIGNAL_KEY, '');
}

export interface MovePlanResult {
  projectId: number;
  projectName: string;
  steps: number;
  noticeReminderAt: string | null;
  moveDateISO: string | null;
}

/** Create the move plan: a "House move" project, the standard checklist as tasks filed under it, and —
 *  when we know the lease end + notice period — a scheduled reminder to GIVE NOTICE on time. */
export async function createMovePlan(db: SQLiteDatabase, signal: StoredMoveSignal): Promise<MovePlanResult> {
  const captureId = signal.captureId ?? 0;
  const projects = await listProjects(db);
  const existing = projects.find((p) => p.name.trim().toLowerCase() === PROJECT_NAME.toLowerCase());
  const projectId = existing?.id ?? await createProject(db, PROJECT_NAME, 'Your move — the standard steps, plus the notice deadline LUCY will chase.');

  const moveDateISO = signal.dates.find((d) => d.label === 'Move date')?.dueISO
    ?? signal.dates.find((d) => !!d.dueISO)?.dueISO
    ?? null;
  const leaseEndISO = signal.dates.find((d) => d.label === 'Lease ends')?.dueISO ?? null;
  const dated = moveDateISO ? relocationPlan(moveDateISO) : [];
  const dueFor = (task: string): string | null => dated.find((p) => p.task === task)?.dueISO ?? null;

  // Seed the checklist as tasks filed under the project (context = project name → gathers via projectActivity).
  const { insertTodo } = await import('../db/todos');
  for (const step of RELOCATION_CHECKLIST) {
    const isNotice = /notice/i.test(step.task);
    const due = dueFor(step.task);
    const context = due
      ? `${PROJECT_NAME} · by ${new Date(due).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
      : PROJECT_NAME;
    await insertTodo(db, captureId, { task: step.task, category: 'errand', urgency: isNotice ? 'high' : 'medium', context }, 'normal');
  }

  // Chase the notice deadline (lease end − notice period) as a real, scheduled reminder.
  let noticeReminderAt: string | null = null;
  if (leaseEndISO) {
    noticeReminderAt = noticeDeadline(leaseEndISO, signal.noticeDays ?? 30);
    if (noticeReminderAt) {
      try {
        const { insertReminder, markReminderScheduled } = await import('../db/reminders');
        const reminder = { text: 'Give your landlord notice for your move', time: noticeReminderAt, urgency: 'high' as const };
        const id = await insertReminder(db, captureId, reminder, 'normal');
        const { scheduleCapturedReminder } = await import('./notifications');
        const notifId = await scheduleCapturedReminder(id, reminder, 'normal', '');
        if (notifId) await markReminderScheduled(db, id, notifId);
      } catch { /* the plan still stands even if scheduling the notification fails */ }
    }
  }

  // The offer is consumed.
  await setSetting(db, SIGNAL_KEY, '');
  return { projectId, projectName: PROJECT_NAME, steps: RELOCATION_CHECKLIST.length, noticeReminderAt, moveDateISO };
}
