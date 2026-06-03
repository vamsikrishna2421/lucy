import type { SQLiteDatabase } from 'expo-sqlite';

export interface NotifLogRow {
  id: number;
  created_at: string;
  identifier: string;
  kind: string;
  tier: 1 | 2 | 3;
  title: string;
  body: string | null;
  scheduled_for: string | null;
  read_at: string | null;
  dismissed_at: string | null;
  expired_at: string | null;
  entity_id: string | null;
  entity_kind: string | null;
}

export type NotifFilter = 'all' | 'urgent' | 'insights' | 'muted';

export async function upsertNotifLog(
  db: SQLiteDatabase,
  row: Pick<NotifLogRow, 'identifier' | 'kind' | 'tier' | 'title' | 'body' | 'scheduled_for' | 'entity_id' | 'entity_kind'>,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO lucy_notifications (identifier, kind, tier, title, body, scheduled_for, entity_id, entity_kind)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(identifier) DO UPDATE SET
       title = excluded.title,
       body = excluded.body,
       scheduled_for = excluded.scheduled_for,
       read_at = NULL,
       dismissed_at = NULL`,
    row.identifier, row.kind, row.tier, row.title, row.body ?? null,
    row.scheduled_for ?? null, row.entity_id ?? null, row.entity_kind ?? null,
  );
}

export async function markNotifRead(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync(
    'UPDATE lucy_notifications SET read_at = CURRENT_TIMESTAMP WHERE id = ? AND read_at IS NULL', id,
  );
}

export async function markAllInsightsRead(db: SQLiteDatabase): Promise<void> {
  await db.runAsync(
    'UPDATE lucy_notifications SET read_at = CURRENT_TIMESTAMP WHERE tier >= 2 AND read_at IS NULL AND dismissed_at IS NULL',
  );
}

export async function dismissNotif(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync(
    'UPDATE lucy_notifications SET dismissed_at = CURRENT_TIMESTAMP WHERE id = ?', id,
  );
}

export async function expireNotifsByEntity(
  db: SQLiteDatabase,
  entityKind: string,
  entityId: string,
): Promise<void> {
  await db.runAsync(
    `UPDATE lucy_notifications SET expired_at = CURRENT_TIMESTAMP
     WHERE entity_kind = ? AND entity_id = ? AND expired_at IS NULL`,
    entityKind, entityId,
  );
}

export async function getTier1UnreadCount(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM lucy_notifications WHERE tier = 1 AND read_at IS NULL AND dismissed_at IS NULL AND expired_at IS NULL',
  );
  return Number(row?.n ?? 0);
}

export async function getTotalUnreadCount(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM lucy_notifications WHERE read_at IS NULL AND dismissed_at IS NULL AND expired_at IS NULL',
  );
  return Number(row?.n ?? 0);
}

export async function listNotifLog(
  db: SQLiteDatabase,
  filter: NotifFilter = 'all',
  limit = 60,
): Promise<NotifLogRow[]> {
  const tierClause =
    filter === 'urgent' ? 'AND tier = 1' :
    filter === 'insights' ? 'AND tier = 2' :
    filter === 'muted' ? 'AND tier = 3' : '';
  return db.getAllAsync<NotifLogRow>(
    `SELECT * FROM lucy_notifications
     WHERE dismissed_at IS NULL ${tierClause}
     ORDER BY
       CASE WHEN expired_at IS NULL THEN 0 ELSE 1 END ASC,
       CASE WHEN read_at IS NULL THEN 0 ELSE 1 END ASC,
       created_at DESC
     LIMIT ?`,
    limit,
  );
}
