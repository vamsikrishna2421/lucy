/** Persistence for LUCY-scheduled task-blocks (the plan layer above the device calendar). */
import type { SQLiteDatabase } from 'expo-sqlite';
import type { Block, TaskResources } from '../scheduling/types';

export type BlockStatus = 'proposed' | 'committed' | 'done' | 'cancelled';

export interface ScheduledBlockRow {
  id: number;
  todo_id: number | null;
  title: string;
  start_at: number;
  end_at: number;
  resources: string;       // JSON TaskResources
  energy: string | null;
  location: string | null;
  status: BlockStatus;
  locked: number;
  calendar_event_id: string | null;
  created_at: string;
}

export interface NewBlock {
  todoId?: number | null;
  title: string;
  startMs: number;
  endMs: number;
  resources: TaskResources;
  energy?: string | null;
  location?: string | null;
  status?: BlockStatus;
  calendarEventId?: string | null;
}

export async function createScheduledBlock(db: SQLiteDatabase, b: NewBlock): Promise<number> {
  const res = await db.runAsync(
    `INSERT INTO scheduled_blocks (todo_id, title, start_at, end_at, resources, energy, location, status, locked, calendar_event_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    b.todoId ?? null, b.title, b.startMs, b.endMs, JSON.stringify(b.resources),
    b.energy ?? null, b.location ?? null, b.status ?? 'committed', b.calendarEventId ?? null,
  );
  return res.lastInsertRowId;
}

export async function listScheduledBlocks(
  db: SQLiteDatabase, fromMs: number, toMs: number, statuses: BlockStatus[] = ['committed'],
): Promise<ScheduledBlockRow[]> {
  const placeholders = statuses.map(() => '?').join(',');
  return db.getAllAsync<ScheduledBlockRow>(
    `SELECT * FROM scheduled_blocks
     WHERE status IN (${placeholders}) AND end_at > ? AND start_at < ?
     ORDER BY start_at ASC`,
    ...statuses, fromMs, toMs,
  );
}

export async function getScheduledBlock(db: SQLiteDatabase, id: number): Promise<ScheduledBlockRow | null> {
  return db.getFirstAsync<ScheduledBlockRow>('SELECT * FROM scheduled_blocks WHERE id = ?', id);
}

export async function setBlockStatus(db: SQLiteDatabase, id: number, status: BlockStatus): Promise<void> {
  await db.runAsync('UPDATE scheduled_blocks SET status = ? WHERE id = ?', status, id);
}

export async function setBlockCalendarEvent(db: SQLiteDatabase, id: number, calendarEventId: string | null): Promise<void> {
  await db.runAsync('UPDATE scheduled_blocks SET calendar_event_id = ? WHERE id = ?', calendarEventId, id);
}

export async function setBlockLocked(db: SQLiteDatabase, id: number, locked: boolean): Promise<void> {
  await db.runAsync('UPDATE scheduled_blocks SET locked = ? WHERE id = ?', locked ? 1 : 0, id);
}

export async function deleteScheduledBlock(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM scheduled_blocks WHERE id = ?', id);
}

/** Convert a row into the engine's Block shape. */
export function rowToBlock(r: ScheduledBlockRow): Block {
  let resources: TaskResources;
  try { resources = JSON.parse(r.resources) as TaskResources; } catch { resources = { axes: ['focus', 'self'], location: null }; }
  return {
    id: r.id,
    title: r.title,
    start: r.start_at,
    end: r.end_at,
    resources,
    source: 'scheduled',
    locked: r.locked === 1,
    todoId: r.todo_id,
    calendarEventId: r.calendar_event_id,
  };
}
