import type { SQLiteDatabase } from 'expo-sqlite';
import { archiveCapture, linkCaptureUpdate, markCaptureProcessed, type CaptureRow } from '../db/captures';
import { insertContextRequest } from '../db/contextRequests';
import { findPendingPaymentTodo, markTodoCompleted } from '../db/todos';

export function isPaymentCompletionFollowUp(transcript: string): boolean {
  return /^\s*(?:i\s+)?(?:paid(?:\s+it)?|payment\s+(?:is\s+)?done|rent\s+(?:is\s+)?paid)\s*[.!]?\s*$/i.test(transcript);
}

export async function archiveUnmatchedCompletionRetries(db: SQLiteDatabase): Promise<void> {
  const retryingOrArchived = await db.getAllAsync<CaptureRow>(
    'SELECT * FROM captures WHERE processed IN (-1, 3) AND parent_capture_id IS NULL',
  );
  for (const capture of retryingOrArchived) {
    if (!isPaymentCompletionFollowUp(capture.raw_transcript)) {
      continue;
    }
    const todo = await findPendingPaymentTodo(db, capture.created_at);
    if (!todo) {
      if (capture.processed !== 3) {
        await archiveCapture(
          db,
          capture.id,
          'Previously unmatched short completion removed from active retries and retained in local history.',
        );
      }
      await insertContextRequest(
        db,
        capture.id,
        capture.raw_transcript,
        'What earlier task did this completion update refer to?',
        'LUCY could not safely link this short update to an earlier task.',
      );
    }
  }
}

export async function resolveCompletionFollowUp(
  db: SQLiteDatabase,
  capture: CaptureRow,
): Promise<boolean> {
  if (!isPaymentCompletionFollowUp(capture.raw_transcript)) {
    return false;
  }
  const todo = await findPendingPaymentTodo(db, capture.created_at);
  if (!todo) {
    await archiveCapture(
      db,
      capture.id,
      'Short completion update kept in history because no earlier matching payment task was found.',
    );
    await insertContextRequest(
      db,
      capture.id,
      capture.raw_transcript,
      'What earlier task did this completion update refer to?',
      'LUCY could not safely link this short update to an earlier task.',
    );
    return true;
  }
  await db.withTransactionAsync(async () => {
    await markTodoCompleted(db, todo.id);
    await linkCaptureUpdate(
      db,
      capture.id,
      todo.capture_id,
      todo.privacy_level,
      `Completed: ${todo.task}`,
    );
    await markCaptureProcessed(db, capture.id);
  });
  return true;
}
