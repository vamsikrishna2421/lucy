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
import { normalizeResources } from './resources';
import { DAY, startOfLocalDay } from './time';
import {
  createScheduledBlock, listScheduledBlocks, getScheduledBlock, deleteScheduledBlock, rowToBlock,
} from '../db/schedule';

export * from './types';
export { canCoexist, describeResources } from './resources';
export { classifyTask } from './classify';

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

/** The plan for [fromMs,toMs]: calendar events + committed task-blocks + any conflicts. */
export async function getPlan(db: SQLiteDatabase, fromMs: number, toMs: number): Promise<DayPlan> {
  const av = await getAvailability(db);
  const { resourceBlocks } = await buildBusy(db, fromMs, toMs, av);
  const blocks = resourceBlocks.filter((b) => b.end > fromMs && b.start < toMs).sort((a, b) => a.start - b.start);
  return { from: fromMs, to: toMs, blocks, conflicts: validatePlan(blocks) };
}
