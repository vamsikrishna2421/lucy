import * as Notifications from 'expo-notifications';
import { getDatabase } from '../db';

interface ScheduledNotificationRow {
  notification_id: string | null;
}

export async function queueFullMemoryReprocessing(): Promise<number> {
  const db = await getDatabase();
  const active = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM captures WHERE processed = 2',
  );
  if (Number(active?.count ?? 0) > 0) {
    throw new Error('Wait for the current memory to finish organizing before starting a full rebuild.');
  }
  const scheduled = await db.getAllAsync<ScheduledNotificationRow>(
    'SELECT notification_id FROM reminders WHERE notification_id IS NOT NULL',
  );
  await Promise.all(scheduled.flatMap((row) => (
    row.notification_id
      ? [Notifications.cancelScheduledNotificationAsync(row.notification_id).catch(() => undefined)]
      : []
  )));

  // Individual runAsync per statement — multi-statement execAsync is unreliable under
  // SQLCipher (same issue that broke "delete all"); a single exec can silently no-op.
  const purgeStatements = [
    'DELETE FROM todos',
    'DELETE FROM expenses',
    'DELETE FROM ideas',
    'DELETE FROM places',
    'DELETE FROM interests',
    'DELETE FROM reminders',
    'DELETE FROM people',
    'DELETE FROM extractions',
    'DELETE FROM knowledge_connections',
    'DELETE FROM knowledge_entities',
    'DELETE FROM knowledge_insights',
    'DELETE FROM organization_runs',
    "DELETE FROM context_requests WHERE status = 'open'",
  ];
  await db.withTransactionAsync(async () => {
    for (const stmt of purgeStatements) {
      await db.runAsync(stmt);
    }
    await db.runAsync(`
      UPDATE captures SET
        privacy_level = CASE WHEN user_marked_private = 1 THEN 'private' ELSE 'normal' END,
        processed = 0,
        processing_error = NULL,
        extracted_title = NULL,
        structured_text = NULL,
        processed_at = NULL,
        attempt_count = 0,
        next_attempt_at = NULL,
        parent_capture_id = NULL,
        capture_kind = 'thought',
        archived_at = NULL,
        archive_reason = NULL
    `);
  });

  const count = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM captures');
  return Number(count?.count ?? 0);
}
