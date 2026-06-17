/**
 * Staleness Detection & Cleanup Engine
 *
 * Covers four problem classes:
 *   1. Stale reminders  — remind_at is in the past by > threshold, auto-archive
 *   2. Outdated todos   — task text references a past scheduled time, queue for user confirmation
 *   3. Duplicate todos  — two pending todos that describe the same thing, queue for merge confirm
 *   4. Context overflow — more than MAX_CONTEXT_SHOWN open context_requests, batch them
 *
 * The engine is pure logic (no React). It reads from the DB and writes back.
 * Dashboard/NowView reads the pending_staleness_reviews table to show in-app prompts.
 */

import type { SQLiteDatabase } from 'expo-sqlite';
import { archiveReminder, listReminders } from '../db/reminders';
import { archiveTodo, listPendingTodos } from '../db/todos';
import { cosineSimilarity, generateEmbedding } from '../ai/embeddings';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Reminders whose fire time is this many ms in the past are auto-archived silently. */
const REMINDER_SILENT_ARCHIVE_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Reminders that fired within the last 24 h are in the "confirm" zone:
 * we show one gentle prompt before auto-archiving on the NEXT nightly run.
 */
const REMINDER_CONFIRM_GRACE_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Todos older than this with a relative-time phrase ("tomorrow", "at 3pm") are reviewed. */
const TODO_STALE_THRESHOLD_MS = 4 * 60 * 60 * 1000; // 4 hours — relative phrases expire fast

/** Cosine similarity floor for flagging two todos as duplicates. */
const DUP_SIMILARITY_THRESHOLD = 0.82;

/** Maximum context requests shown at once in Focus Now. */
const MAX_CONTEXT_SHOWN = 3;

/** How long a staleness review prompt lives before it auto-expires (user ignored it). */
const REVIEW_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ─── Temporal phrase detection ───────────────────────────────────────────────

/** Returns an estimated event Date from natural-language phrases in a todo task string.
 *  Returns null if no time reference is found. */
export function extractScheduledDate(text: string, createdAt: string): Date | null {
  const t = text.toLowerCase();
  const created = new Date(createdAt.includes('T') ? createdAt : `${createdAt.replace(' ', 'T')}Z`);

  // "tomorrow at 3pm" / "tomorrow at 15:00"
  const tomorrowMatch = t.match(/\btomorrow\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (tomorrowMatch) {
    const d = new Date(created);
    d.setDate(d.getDate() + 1);
    const hr = parseInt(tomorrowMatch[1]);
    const min = parseInt(tomorrowMatch[2] ?? '0');
    const mer = tomorrowMatch[3]?.toLowerCase() ?? 'am';
    d.setHours(mer === 'pm' ? (hr % 12) + 12 : hr % 12, min, 0, 0);
    return d;
  }

  // "today at Xpm"
  const todayMatch = t.match(/\btoday\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (todayMatch) {
    const d = new Date(created);
    const hr = parseInt(todayMatch[1]);
    const min = parseInt(todayMatch[2] ?? '0');
    const mer = todayMatch[3].toLowerCase();
    d.setHours(mer === 'pm' ? (hr % 12) + 12 : hr % 12, min, 0, 0);
    return d;
  }

  // "schedule a meeting [at] 3pm EST" etc — absolute time without day anchor.
  // Use created_at date as the base day.
  const timeOnly = t.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (timeOnly) {
    const d = new Date(created);
    const hr = parseInt(timeOnly[1]);
    const min = parseInt(timeOnly[2] ?? '0');
    const mer = timeOnly[3].toLowerCase();
    d.setHours(mer === 'pm' ? (hr % 12) + 12 : hr % 12, min, 0, 0);
    return d;
  }

  // "in N minutes/hours" — relative from capture time
  const inMatch = t.match(/\bin\s+(\d+)\s+(minute|hour)s?\b/i);
  if (inMatch) {
    const n = parseInt(inMatch[1]);
    const unit = inMatch[2].toLowerCase();
    return new Date(created.getTime() + n * (unit === 'hour' ? 3600000 : 60000));
  }

  // "N-minute timer" / "2 min timer"
  const timerMatch = t.match(/\b(\d+)[- ](minute|min|hour|hr)\s+timer\b/i);
  if (timerMatch) {
    const n = parseInt(timerMatch[1]);
    const unit = timerMatch[2].toLowerCase();
    return new Date(created.getTime() + n * (unit.startsWith('h') ? 3600000 : 60000));
  }

  return null;
}

// ─── DB helpers ──────────────────────────────────────────────────────────────

export interface StalenessReview {
  id: number;
  kind: 'reminder_expired' | 'todo_outdated' | 'todo_duplicate' | 'context_overflow';
  item_id: number;
  item_text: string;
  related_id: number | null;     // second todo id for duplicates, null otherwise
  related_text: string | null;
  scheduled_for: string | null;  // ISO string of the past event time
  created_at: string;
  dismissed_at: string | null;
}

export async function ensureStalenessTable(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS pending_staleness_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      item_id INTEGER NOT NULL,
      item_text TEXT NOT NULL,
      related_id INTEGER,
      related_text TEXT,
      scheduled_for TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      dismissed_at DATETIME
    );
    CREATE INDEX IF NOT EXISTS idx_staleness_kind_item ON pending_staleness_reviews(kind, item_id, dismissed_at);
  `);
}

async function reviewAlreadyExists(
  db: SQLiteDatabase,
  kind: StalenessReview['kind'],
  itemId: number,
  relatedId?: number | null,
): Promise<boolean> {
  const row = await db.getFirstAsync<{ id: number }>(
    `SELECT id FROM pending_staleness_reviews
     WHERE kind = ? AND item_id = ? AND (related_id IS ? OR related_id = ?) AND dismissed_at IS NULL
     LIMIT 1`,
    kind, itemId, relatedId ?? null, relatedId ?? null,
  );
  return row !== null;
}

async function insertReview(
  db: SQLiteDatabase,
  kind: StalenessReview['kind'],
  itemId: number,
  itemText: string,
  relatedId: number | null,
  relatedText: string | null,
  scheduledFor: string | null,
): Promise<void> {
  if (await reviewAlreadyExists(db, kind, itemId, relatedId)) return;
  await db.runAsync(
    `INSERT INTO pending_staleness_reviews (kind, item_id, item_text, related_id, related_text, scheduled_for)
     VALUES (?, ?, ?, ?, ?, ?)`,
    kind, itemId, itemText, relatedId, relatedText, scheduledFor,
  );
}

export async function listPendingReviews(db: SQLiteDatabase): Promise<StalenessReview[]> {
  return db.getAllAsync<StalenessReview>(
    `SELECT * FROM pending_staleness_reviews
     WHERE dismissed_at IS NULL
     ORDER BY CASE kind
       WHEN 'reminder_expired' THEN 0
       WHEN 'todo_outdated'    THEN 1
       WHEN 'todo_duplicate'   THEN 2
       ELSE 3
     END, created_at ASC`,
  );
}

export async function dismissReview(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync(
    'UPDATE pending_staleness_reviews SET dismissed_at = CURRENT_TIMESTAMP WHERE id = ?',
    id,
  );
}

/** Auto-purge reviews older than REVIEW_EXPIRY_MS to prevent unbounded growth. */
async function purgeExpiredReviews(db: SQLiteDatabase): Promise<void> {
  await db.runAsync(
    `DELETE FROM pending_staleness_reviews
     WHERE dismissed_at IS NOT NULL
        OR created_at < datetime('now', '-7 days')`,
  );
}

// ─── Stale reminder detection ────────────────────────────────────────────────

/**
 * Rule matrix:
 *
 *  | remind_at age        | has notification_id | action                      |
 *  |---------------------|--------------------|-----------------------------|
 *  | > 24 h past          | any                | silent auto-archive          |
 *  | 0–24 h past          | yes (was scheduled)| queue review prompt          |
 *  | 0–24 h past          | no  (never fired)  | silent auto-archive          |
 *  | no remind_at, >7 days old | -             | queue review prompt          |
 */
async function processStaleReminders(db: SQLiteDatabase): Promise<number> {
  const reminders = await listReminders(db);
  const now = Date.now();
  let count = 0;

  for (const r of reminders) {
    if (!r.remind_at) {
      // No time set — if the reminder is very old and unscheduled, flag it
      const age = now - new Date(r.created_at.includes('T') ? r.created_at : `${r.created_at.replace(' ', 'T')}Z`).getTime();
      if (age > 7 * 24 * 60 * 60 * 1000) {
        await insertReview(db, 'reminder_expired', r.id, r.text, null, null, null);
        count++;
      }
      continue;
    }

    const fireTime = new Date(r.remind_at).getTime();
    if (!Number.isFinite(fireTime)) continue;
    const overdue = now - fireTime;
    if (overdue <= 0) continue; // not yet due

    // Recurring reminders advance to their next future occurrence (and reschedule the nag) instead
    // of being archived/reviewed — that's what makes "every month on the 5th" actually repeat.
    if (r.recurrence) {
      const { advanceRecurringReminder } = await import('../db/reminders');
      const nextMs = await advanceRecurringReminder(db, r.id, now);
      if (nextMs !== null) {
        const nextReminder = { ...r, time: new Date(nextMs).toISOString() };
        const { scheduleCapturedReminder } = await import('./notifications');
        const key = await scheduleCapturedReminder(r.id, nextReminder, r.privacy_level, r.text).catch(() => null);
        if (key) { const { markReminderScheduled } = await import('../db/reminders'); await markReminderScheduled(db, r.id, key); }
        count++;
        continue;
      }
    }

    if (overdue > REMINDER_SILENT_ARCHIVE_MS) {
      // More than 24 hours past — silent archive, no prompt needed
      await archiveReminder(db, r.id, 'auto-archived: reminder time passed by more than 24 hours');
      count++;
    } else {
      // Within the 0–24 h window — show one review prompt
      if (r.notification_id) {
        // It was properly scheduled, so the user may have acted on it.  Ask.
        await insertReview(db, 'reminder_expired', r.id, r.text, null, null, r.remind_at);
        count++;
      } else {
        // Never scheduled (no time was parseable at capture time) — safe to auto-archive
        await archiveReminder(db, r.id, 'auto-archived: time-less reminder older than fire window');
        count++;
      }
    }
  }
  return count;
}

// ─── Outdated scheduled todo detection ───────────────────────────────────────

/**
 * If a pending todo contains a relative-time phrase ("tomorrow at 3pm",
 * "2-minute timer") AND the calculated event time is now in the past by more
 * than TODO_STALE_THRESHOLD_MS, queue a review prompt for the user.
 *
 * We never auto-archive todos without confirmation — unlike reminders, they
 * may represent longer-lived intent ("schedule a meeting...") where the user
 * forgot to delete after completing.
 */
async function processOutdatedTodos(db: SQLiteDatabase): Promise<number> {
  const todos = await listPendingTodos(db);
  const now = Date.now();
  let count = 0;

  for (const t of todos) {
    const scheduledDate = extractScheduledDate(t.task, t.created_at);
    if (!scheduledDate) continue;

    const overdue = now - scheduledDate.getTime();
    if (overdue > TODO_STALE_THRESHOLD_MS) {
      await insertReview(
        db,
        'todo_outdated',
        t.id,
        t.task,
        null,
        null,
        scheduledDate.toISOString(),
      );
      count++;
    }
  }
  return count;
}

// ─── Duplicate todo detection ─────────────────────────────────────────────────

/**
 * Strategy (two-pass, offline-first):
 *
 *  Pass 1 — keyword overlap (always runs, no network):
 *    Tokenise both task strings. If overlap ratio >= 0.55 by unique-word Jaccard,
 *    the pair is a candidate.
 *
 *  Pass 2 — embedding cosine similarity (runs when available):
 *    If a candidate passes keyword overlap, compute or reuse stored embeddings.
 *    If cosine similarity >= DUP_SIMILARITY_THRESHOLD, flag as duplicate.
 *
 *  We skip Pass 2 when no embedding model is available and fall back to
 *  keyword overlap alone with a tighter threshold (0.70).
 */

const STOP = new Set(['a','an','the','and','or','but','in','on','at','to','for','of','with','by','from','is','was','i','my','me']);

function todoTokens(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

function jaccardOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const w of a) { if (b.has(w)) intersection++; }
  const union = a.size + b.size - intersection;
  return intersection / union;
}

async function processDuplicateTodos(db: SQLiteDatabase): Promise<number> {
  const todos = await listPendingTodos(db);
  if (todos.length < 2) return 0;

  let count = 0;
  // Build keyword token sets up front
  const tokenSets = todos.map((t) => todoTokens(t.task));

  for (let i = 0; i < todos.length; i++) {
    for (let j = i + 1; j < todos.length; j++) {
      const a = todos[i];
      const b = todos[j];

      // Skip if we already have an active review for this pair
      if (await reviewAlreadyExists(db, 'todo_duplicate', a.id, b.id)) continue;
      if (await reviewAlreadyExists(db, 'todo_duplicate', b.id, a.id)) continue;

      const jaccard = jaccardOverlap(tokenSets[i], tokenSets[j]);
      const KEYWORD_FLOOR = 0.45; // candidates above this go to embedding check
      const KEYWORD_DIRECT = 0.72; // above this → flag without embeddings

      if (jaccard < KEYWORD_FLOOR) continue;

      if (jaccard >= KEYWORD_DIRECT) {
        // High keyword overlap — flag directly
        await insertReview(db, 'todo_duplicate', a.id, a.task, b.id, b.task, null);
        count++;
        continue;
      }

      // Mid-range keyword overlap — escalate to embedding similarity
      try {
        const [vecA, vecB] = await Promise.all([
          generateEmbedding(a.task),
          generateEmbedding(b.task),
        ]);
        const sim = cosineSimilarity(vecA.vector, vecB.vector);
        if (sim >= DUP_SIMILARITY_THRESHOLD) {
          await insertReview(db, 'todo_duplicate', a.id, a.task, b.id, b.task, null);
          count++;
        }
      } catch {
        // Embedding unavailable — trust the keyword signal alone (looser threshold)
        if (jaccard >= 0.60) {
          await insertReview(db, 'todo_duplicate', a.id, a.task, b.id, b.task, null);
          count++;
        }
      }
    }
  }
  return count;
}

// ─── Context overflow detection ───────────────────────────────────────────────

/**
 * This detector does NOT archive or merge anything.  It only inserts a single
 * 'context_overflow' review so the UI can show the batched experience.
 * The review's item_text carries the count as a string for the UI to format.
 */
async function processContextOverflow(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM context_requests WHERE status = 'open'`,
  );
  const openCount = row?.n ?? 0;
  if (openCount <= MAX_CONTEXT_SHOWN) return 0;

  // Check if a non-dismissed overflow review already exists
  const existing = await db.getFirstAsync<{ id: number }>(
    `SELECT id FROM pending_staleness_reviews
     WHERE kind = 'context_overflow' AND dismissed_at IS NULL LIMIT 1`,
  );
  if (existing) return 0;

  await db.runAsync(
    `INSERT INTO pending_staleness_reviews (kind, item_id, item_text, related_id, related_text, scheduled_for)
     VALUES ('context_overflow', 0, ?, NULL, NULL, NULL)`,
    String(openCount),
  );
  return 1;
}

// ─── Context request batching ─────────────────────────────────────────────────

export interface ContextBatch {
  /** The three (or fewer) requests to show right now */
  visible: import('../db/contextRequests').ContextRequestRow[];
  /** Total open count */
  total: number;
  /** How many low-priority requests can be bulk-dismissed */
  lowPriorityCount: number;
}

export async function getContextBatch(db: SQLiteDatabase): Promise<ContextBatch> {
  const all = await db.getAllAsync<import('../db/contextRequests').ContextRequestRow>(
    `SELECT * FROM context_requests WHERE status = 'open'
     ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
     created_at ASC, id ASC`,
  );
  const lowPriorityCount = all.filter((r) => r.priority === 'low').length;
  return {
    visible: all.slice(0, MAX_CONTEXT_SHOWN),
    total: all.length,
    lowPriorityCount,
  };
}

/** Dismiss all low-priority open context requests at once. */
export async function dismissAllLowPriorityContext(db: SQLiteDatabase): Promise<number> {
  const result = await db.runAsync(
    `UPDATE context_requests SET status = 'dismissed', answered_at = CURRENT_TIMESTAMP
     WHERE status = 'open' AND priority = 'low'`,
  );
  return result.changes ?? 0;
}

// ─── Ignored duplicate cleanup ───────────────────────────────────────────────

/**
 * When a duplicate-todo suggestion has been sitting unacknowledged for 7 days,
 * LUCY auto-archives the LOWER-CONFIDENCE item (never auto-merges — merging
 * risks losing nuance the user intended to keep separate).
 *
 * "Lower confidence" = the item with fewer captured words / less context.
 * Ties are broken by created_at (newer = less established = discard).
 */
async function archiveIgnoredDuplicates(db: SQLiteDatabase): Promise<number> {
  const stale = await db.getAllAsync<{
    id: number; item_id: number; item_text: string;
    related_id: number; related_text: string;
  }>(
    `SELECT id, item_id, item_text, related_id, related_text
     FROM pending_staleness_reviews
     WHERE kind = 'todo_duplicate'
       AND dismissed_at IS NULL
       AND created_at < datetime('now', '-7 days')`,
  );

  let count = 0;
  for (const review of stale) {
    // Determine which todo is "lower confidence" (shorter task text = less context)
    const discardId = review.item_text.length >= review.related_text.length
      ? review.related_id  // related is shorter → discard it
      : review.item_id;    // item is shorter → discard it

    const { archiveTodo } = await import('../db/todos');
    await archiveTodo(db, discardId, 'auto-archived: duplicate todo ignored for 7 days').catch(() => {});

    // Mark the review as dismissed so it doesn't re-trigger
    await db.runAsync(
      'UPDATE pending_staleness_reviews SET dismissed_at = CURRENT_TIMESTAMP WHERE id = ?',
      review.id,
    );
    count++;
  }
  return count;
}

// ─── Main nightly job ─────────────────────────────────────────────────────────

export interface StalenessRunResult {
  remindersArchived: number;
  remindersQueued: number;
  todosQueued: number;
  duplicatesQueued: number;
  contextOverflow: boolean;
}

/**
 * Run the full staleness sweep.  Called from background.ts once per background cycle.
 * Rate-limited to at most once every 6 hours (setting: staleness_last_run).
 */
export async function runStalenessCheck(
  db: SQLiteDatabase,
  force = false,
): Promise<StalenessRunResult | null> {
  await ensureStalenessTable(db);

  // Rate-limit: only run once every 6 hours unless forced
  if (!force) {
    const lastRun = await db.getFirstAsync<{ value: string }>(
      `SELECT value FROM settings WHERE key = 'staleness_last_run'`,
    );
    if (lastRun?.value) {
      const elapsed = Date.now() - new Date(lastRun.value).getTime();
      if (elapsed < 6 * 60 * 60 * 1000) return null;
    }
  }

  await purgeExpiredReviews(db);
  // Auto-archive ignored duplicate-todo suggestions older than 7 days.
  // We never auto-MERGE (merging risks losing nuance), only archive the
  // lower-confidence duplicate (newer / less context) so the better one survives.
  await archiveIgnoredDuplicates(db);

  // Reminders must run first (it archives + queues), then we count reviews.
  const archived = await processStaleReminders(db);
  const remindersQueued = (await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM pending_staleness_reviews
     WHERE kind = 'reminder_expired' AND dismissed_at IS NULL`,
  ))?.n ?? 0;

  // Todos and duplicate detection can run in parallel
  const [todosQueued, duplicatesQueued, contextCount] = await Promise.all([
    processOutdatedTodos(db),
    processDuplicateTodos(db),
    processContextOverflow(db),
  ]);

  await db.runAsync(
    `INSERT OR REPLACE INTO settings (key, value) VALUES ('staleness_last_run', ?)`,
    new Date().toISOString(),
  );

  return {
    remindersArchived: archived,
    remindersQueued,
    todosQueued,
    duplicatesQueued,
    contextOverflow: contextCount > 0,
  };
}
