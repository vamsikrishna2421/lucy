/**
 * Intelligent Calendar — orchestration. Ties the pure engine (classify/freeBusy/scheduler) to the
 * DB (scheduled_blocks) and the device calendar. Public API used by the server + Ask + UI.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import type { Block, SchedTaskMeta, SlotSuggestion, TaskResources } from './types';
import { classifyTask } from './classify';
import { getAvailability } from './availability';
import { nonWorkingBlocks } from './freeBusy';
import { findSlots, validatePlan, type PlanConflict } from './scheduler';
import { rationale } from './scorer';
import { normalizeResources, describeResources } from './resources';
import { DAY, startOfLocalDay } from './time';
import {
  createScheduledBlock, listScheduledBlocks, getScheduledBlock, deleteScheduledBlock, rowToBlock,
} from '../db/schedule';

export * from './types';
export { canCoexist, describeResources } from './resources';
export { classifyTask } from './classify';
export { suggestRearrangement, type RearrangeProposal } from './rearrange';

/** Apply a rearrangement proposal: move the displaced blocks, then place the new task. */
export async function applyRearrangement(
  db: SQLiteDatabase,
  input: CommitInput,
  moves: Array<{ blockId: number; to: number }>,
): Promise<{ ok: boolean; blockId?: number; moved: number }> {
  let moved = 0;
  for (const m of moves) { const r = await moveScheduledBlockTo(db, m.blockId, m.to); if (r.ok) moved++; }
  const c = await commitBlock(db, input, { force: true });
  return { ok: c.ok, blockId: c.blockId, moved };
}

/**
 * Build the busy timeline: hard (sleep/hours/protected) + resource (LUCY's own committed blocks).
 * LUCY manages its OWN calendar entirely in on-device memory — no OS/Google Calendar dependency.
 * Fixed commitments (meetings) are added as committed blocks too (see commitBlock / addFixedBlock).
 */
async function buildBusy(db: SQLiteDatabase, fromMs: number, toMs: number, av: Awaited<ReturnType<typeof getAvailability>>) {
  const schedRows = await listScheduledBlocks(db, fromMs, toMs, ['committed']);
  const resourceBlocks: Block[] = schedRows.map(rowToBlock);
  const hardBlocks = nonWorkingBlocks(av, fromMs, toMs);
  return { resourceBlocks, hardBlocks };
}

export interface SuggestResult {
  meta: SchedTaskMeta;
  suggestions: Array<SlotSuggestion & { rationale: string }>;
}

/** Classify free text into a task and suggest conflict-free, ranked slots. */
export async function suggestForText(
  db: SQLiteDatabase, text: string, opts?: { durationMin?: number; deadline?: string | null; maxResults?: number },
): Promise<SuggestResult> {
  const meta = classifyTask(text, { durationMin: opts?.durationMin, deadline: opts?.deadline ?? null });
  return suggestForMeta(db, meta, opts?.maxResults);
}

export async function suggestForTodo(db: SQLiteDatabase, todoId: number, maxResults?: number): Promise<SuggestResult | null> {
  const row = await db.getFirstAsync<{ task: string; context: string | null }>('SELECT task, context FROM todos WHERE id = ?', todoId);
  if (!row?.task) return null;
  const meta = classifyTask(`${row.task} ${row.context ?? ''}`.trim());
  meta.title = row.task;
  const r = await suggestForMeta(db, meta, maxResults);
  return r;
}

async function suggestForMeta(db: SQLiteDatabase, meta: SchedTaskMeta, maxResults?: number): Promise<SuggestResult> {
  const av = await getAvailability(db);
  const now = Date.now();
  const to = meta.deadline && Number.isFinite(Date.parse(meta.deadline))
    ? Math.min(Date.parse(meta.deadline), startOfLocalDay(now) + 8 * DAY)
    : startOfLocalDay(now) + 8 * DAY;
  const { resourceBlocks, hardBlocks } = await buildBusy(db, now, to, av);
  const slots = findSlots({ meta, hardBlocks, resourceBlocks, availability: av, now, maxResults: maxResults ?? 3 });
  return {
    meta,
    suggestions: slots.map((s) => ({ ...s, rationale: rationale(meta, s.start, s.end, s.reasons) })),
  };
}

export interface CommitInput {
  title: string;
  startMs: number;
  endMs: number;
  resources?: TaskResources;
  energy?: string | null;
  location?: string | null;
  todoId?: number | null;
}

export interface CommitResult {
  ok: boolean;
  blockId?: number;
  conflict?: PlanConflict | null;
}

/**
 * Commit a slot into LUCY's own calendar (on-device only). Re-validates it's still conflict-free
 * and refuses (reporting why) if a conflict appeared since the suggestion — unless `force` is set
 * (used for fixed commitments the user KNOWS they have; the conflict is then surfaced in the plan).
 */
export async function commitBlock(db: SQLiteDatabase, input: CommitInput, opts?: { force?: boolean }): Promise<CommitResult> {
  const resources = normalizeResources(input.resources ?? { axes: ['focus', 'self'], location: input.location ?? null });
  const av = await getAvailability(db);
  const { resourceBlocks, hardBlocks } = await buildBusy(db, input.startMs - DAY, input.endMs + DAY, av);

  const candidate: Block = { title: input.title, start: input.startMs, end: input.endMs, resources, source: 'scheduled' };
  if (!opts?.force) {
    // Defend the invariant at commit time (sleep/off-hours/protected, then resource conflicts).
    for (const b of hardBlocks) {
      if (b.start < candidate.end && candidate.start < b.end) {
        return { ok: false, conflict: { a: candidate, b, reason: 'That time is in a sleep/off-hours/protected window.' } };
      }
    }
    const conflicts = validatePlan([...resourceBlocks, candidate]);
    const mine = conflicts.find((c) => c.a === candidate || c.b === candidate);
    if (mine) return { ok: false, conflict: mine };
  }

  const blockId = await createScheduledBlock(db, {
    todoId: input.todoId ?? null, title: input.title, startMs: input.startMs, endMs: input.endMs,
    resources, energy: input.energy ?? null, location: resources.location ?? null, status: 'committed',
  });
  return { ok: true, blockId };
}

/**
 * Commit a RECURRING series ("every day gym at 6:30") — creates occurrences over the next
 * `horizonDays` matching the pattern, force-added (the user asked for the routine), de-duped so
 * re-running doesn't double-book. Returns how many were created.
 */
export async function commitSeries(
  db: SQLiteDatabase,
  input: CommitInput,
  recurrence: 'daily' | 'weekdays' | 'weekly',
  horizonDays = 28,
): Promise<{ count: number }> {
  const resources = normalizeResources(input.resources ?? { axes: ['focus', 'self'], location: input.location ?? null });
  const todStart = input.startMs - startOfLocalDay(input.startMs);
  const dur = input.endMs - input.startMs;
  const dow0 = new Date(input.startMs).getDay();
  let count = 0;
  for (let i = 0; i < horizonDays; i++) {
    const day = startOfLocalDay(input.startMs) + i * DAY;
    const dow = new Date(day).getDay();
    if (recurrence === 'weekdays' && (dow === 0 || dow === 6)) continue;
    if (recurrence === 'weekly' && dow !== dow0) continue;
    const s = day + todStart; const e = s + dur;
    if (s < Date.now() - 60_000) continue;
    const dupe = await db.getFirstAsync<{ id: number }>(
      "SELECT id FROM scheduled_blocks WHERE status='committed' AND title=? AND start_at<? AND end_at>?", input.title, e, s,
    );
    if (dupe) continue;
    await createScheduledBlock(db, { todoId: input.todoId ?? null, title: input.title, startMs: s, endMs: e, resources, energy: input.energy ?? null, location: resources.location ?? null, status: 'committed' });
    count++;
  }
  return { count };
}

/** Add a fixed commitment (a meeting/appointment the user has) to LUCY's calendar. Always added
 *  (force) so it's ground truth; any resulting conflict is surfaced in the plan for re-slotting. */
export async function addFixedBlock(
  db: SQLiteDatabase, input: { title: string; startMs: number; endMs: number; parallelizable?: boolean; location?: string | null },
): Promise<CommitResult> {
  const resources = input.parallelizable
    ? { axes: [], location: input.location ?? null }
    : { axes: ['focus', 'self'] as Array<'focus' | 'self'>, location: input.location ?? null };
  return commitBlock(db, { title: input.title, startMs: input.startMs, endMs: input.endMs, resources, energy: 'fixed', location: input.location ?? null }, { force: true });
}

/** Move a committed block to a new start (drag-to-reschedule). Keeps duration; reports if the new
 *  time overlaps something it can't run beside (still moves — the user chose it; surfaced in the plan). */
export async function moveScheduledBlockTo(db: SQLiteDatabase, id: number, startMs: number): Promise<{ ok: boolean; conflict?: { a: string; b: string } | null }> {
  const row = await getScheduledBlock(db, id);
  if (!row || !Number.isFinite(startMs)) return { ok: false };
  const dur = row.end_at - row.start_at;
  const endMs = startMs + dur;
  const av = await getAvailability(db);
  const { resourceBlocks } = await buildBusy(db, startMs - DAY, endMs + DAY, av);
  const cand: Block = { title: row.title, start: startMs, end: endMs, resources: rowToBlock(row).resources, source: 'scheduled' };
  const others = resourceBlocks.filter((b) => b.id !== id);
  const conflicts = validatePlan([...others, cand]);
  const mine = conflicts.find((c) => c.a === cand || c.b === cand);
  await db.runAsync('UPDATE scheduled_blocks SET start_at = ?, end_at = ? WHERE id = ?', startMs, endMs, id);
  return { ok: true, conflict: mine ? { a: mine.a.title, b: mine.b.title } : null };
}

export async function cancelBlock(db: SQLiteDatabase, id: number): Promise<boolean> {
  const row = await getScheduledBlock(db, id);
  if (!row) return false;
  await deleteScheduledBlock(db, id);
  return true;
}

export interface DayPlan {
  from: number;
  to: number;
  blocks: Block[];
  conflicts: PlanConflict[];
}

/** The plan for [fromMs,toMs]: committed task-blocks + any conflicts. */
export async function getPlan(db: SQLiteDatabase, fromMs: number, toMs: number): Promise<DayPlan> {
  const av = await getAvailability(db);
  const { resourceBlocks } = await buildBusy(db, fromMs, toMs, av);
  const blocks = resourceBlocks.filter((b) => b.end > fromMs && b.start < toMs).sort((a, b) => a.start - b.start);
  return { from: fromMs, to: toMs, blocks, conflicts: validatePlan(blocks) };
}

/** Pending todos that don't yet have a committed scheduled block. */
export async function unscheduledPendingTodos(db: SQLiteDatabase): Promise<Array<{ id: number; task: string; urgency: string | null }>> {
  const { listPendingTodos } = await import('../db/todos');
  const todos = await listPendingTodos(db);
  const scheduled = await db.getAllAsync<{ todo_id: number }>(
    "SELECT DISTINCT todo_id FROM scheduled_blocks WHERE status = 'committed' AND todo_id IS NOT NULL",
  );
  const taken = new Set(scheduled.map((s) => s.todo_id));
  return todos.filter((t) => !taken.has(t.id)).map((t) => ({ id: t.id, task: t.task, urgency: (t as { urgency?: string | null }).urgency ?? null }));
}

export interface DayProposal {
  todoId: number | null;
  title: string;
  start: number;
  end: number;
  rationale: string;
  resourceLabel: string;
  durationMin: number;
  resources: TaskResources;
  energy: string;
}

/**
 * Auto-plan: place all unscheduled pending todos into conflict-free slots (priority order:
 * deadline, then urgency, then deep work first). Returns PROPOSALS to confirm — nothing is
 * committed until the user accepts (locked decision #2: suggest + confirm).
 */
export async function autoPlanDay(db: SQLiteDatabase, opts?: { horizonDays?: number }): Promise<{ proposals: DayProposal[]; unplaced: string[] }> {
  const av = await getAvailability(db);
  const now = Date.now();
  const horizonDays = opts?.horizonDays ?? 2;
  const to = startOfLocalDay(now) + (horizonDays + 1) * DAY;
  const { resourceBlocks, hardBlocks } = await buildBusy(db, now, to, av);
  const todos = await unscheduledPendingTodos(db);

  const URG: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const tasks = todos.map((t) => ({ t, meta: classifyTask(t.task) }));
  tasks.sort((a, b) => {
    const da = a.meta.deadline ? Date.parse(a.meta.deadline) : Infinity;
    const dbb = b.meta.deadline ? Date.parse(b.meta.deadline) : Infinity;
    if (da !== dbb) return da - dbb;
    const ua = URG[a.t.urgency ?? 'medium'] ?? 1; const ub = URG[b.t.urgency ?? 'medium'] ?? 1;
    if (ua !== ub) return ua - ub;
    return (a.meta.energy === 'deep' ? 0 : 1) - (b.meta.energy === 'deep' ? 0 : 1);
  });

  const virtual: Block[] = [];
  const proposals: DayProposal[] = [];
  const unplaced: string[] = [];
  for (const { t, meta } of tasks) {
    const slots = findSlots({ meta, hardBlocks, resourceBlocks: [...resourceBlocks, ...virtual], availability: av, now, horizonDays, maxResults: 1 });
    if (!slots.length) { unplaced.push(meta.title); continue; }
    const s = slots[0];
    virtual.push({ title: meta.title, start: s.start, end: s.end, resources: meta.resources, source: 'scheduled' });
    proposals.push({
      todoId: t.id, title: meta.title, start: s.start, end: s.end,
      rationale: rationale(meta, s.start, s.end, s.reasons), resourceLabel: describeResources(meta.resources),
      durationMin: meta.durationMin, resources: meta.resources, energy: meta.energy,
    });
  }
  return { proposals, unplaced };
}
