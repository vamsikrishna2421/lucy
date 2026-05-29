import { AIProvider } from '../ai/provider';
import {
  insertCapture,
  insertSharedCapture,
  markCaptureFailed,
  markCaptureProcessed,
  markCaptureProcessing,
  nextQueuedCapture,
  updateCaptureGuardianNote,
  updateCaptureResult,
  type CaptureRow,
} from '../db/captures';
import { getDatabase } from '../db';
import { insertExpense } from '../db/expenses';
import { insertContextRequest } from '../db/contextRequests';
import { insertExtractionSnapshot } from '../db/extractions';
import { insertIdea } from '../db/ideas';
import { upsertInterest } from '../db/interests';
import { upsertPerson } from '../db/people';
import { insertPlace } from '../db/places';
import { insertOpenLoop } from '../db/openLoops';
import { insertFollowUp } from '../db/followUps';
import { insertReminder, markReminderScheduled } from '../db/reminders';
import { insertTodo, listPendingTodos } from '../db/todos';
import type { CaptureSource, ExtractionResult } from '../types/extraction';
import { extractExplicitEnglishFact } from './explicitEnglish';
import { resolveCompletionFollowUp } from './followUp';
import { enforcePrivacy, protectByUserChoice, protectCredentialExtraction } from './privacy';
import { repairReminderTimes } from './reminderTime';
import { normalizeExtraction } from './schema';
import { scheduleCapturedReminder, sendGuardianNotification } from './notifications';
import { writeVaultNote } from './vault';
import { formatStructuredMemory } from './structuredMemory';
import { storeEmbedding } from '../ai/embeddings';
import { getRelatedContext } from './vectorSearch';
import { updatePersonContext } from './relationshipEngine';

function normText(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function isSimilarTask(a: string, b: string): boolean {
  const na = normText(a);
  const nb = normText(b);
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const wordsA = new Set(na.split(' ').filter((w) => w.length > 3));
  const wordsB = new Set(nb.split(' ').filter((w) => w.length > 3));
  if (wordsA.size === 0 || wordsB.size === 0) return false;
  const overlap = [...wordsA].filter((w) => wordsB.has(w)).length;
  return overlap / Math.max(wordsA.size, wordsB.size) > 0.65;
}

function hasMeaningfulExtraction(result: ExtractionResult): boolean {
  return (
    result.title !== 'Untitled capture'
    || result.summary.trim().length > 0
    || result.projects.length > 0
    || result.areas.length > 0
    || result.people.length > 0
    || result.tasks.length > 0
    || result.expenses.length > 0
    || result.ideas.length > 0
    || result.places.length > 0
    || result.interests.length > 0
    || result.decisions.length > 0
    || result.reminders.length > 0
    || result.tags.length > 0
  );
}

export async function analyzeTranscript(
  transcript: string,
  options: { localOnly?: boolean; privacyLevel?: 'private' | 'local' | 'normal' } = {},
): Promise<ExtractionResult> {
  const trimmed = transcript.trim();
  if (!trimmed) {
    throw new Error('Enter text before processing.');
  }
  const preflight = protectByUserChoice(trimmed, options.privacyLevel === 'private');
  const explicitFact = preflight.level === 'normal' ? extractExplicitEnglishFact(trimmed) : null;
  const result = explicitFact
    ? normalizeExtraction(explicitFact)
    : options.localOnly
      ? await AIProvider.analyzeLocally(trimmed)
      : await AIProvider.analyze(trimmed, preflight.level);
  const extraction = protectCredentialExtraction(
    repairReminderTimes(enforcePrivacy(normalizeExtraction(result), preflight), trimmed),
    trimmed,
  );
  if (!hasMeaningfulExtraction(extraction)) {
    throw new Error('On-device extraction was empty; LUCY will retry automatically.');
  }
  return extraction;
}

export async function enqueueTranscript(
  transcript: string,
  source: CaptureSource = 'text',
  markedPrivate = false,
): Promise<number> {
  const trimmed = transcript.trim();
  if (!trimmed) {
    throw new Error('Enter text before capturing.');
  }
  const db = await getDatabase();
  const preflight = protectByUserChoice(trimmed, markedPrivate);
  if (source === 'android' || source === 'ios') {
    return insertSharedCapture(db, source, trimmed, preflight.level, markedPrivate);
  }
  return insertCapture(db, source, trimmed, preflight.level, markedPrivate);
}

async function persistExtraction(
  capture: CaptureRow,
  extraction: ExtractionResult,
): Promise<void> {
  const db = await getDatabase();
  const reminderRows: Array<{ id: number; reminder: ExtractionResult['reminders'][number] }> = [];

  await db.withTransactionAsync(async () => {
    const existingTodos = await listPendingTodos(db);
    for (const task of extraction.tasks) {
      const isDuplicate = existingTodos.some((existing) => isSimilarTask(existing.task, task.task));
      if (!isDuplicate) {
        await insertTodo(db, capture.id, task, extraction.privacy_level);
      }
    }
    for (const expense of extraction.expenses) {
      await insertExpense(db, capture.id, expense, extraction.privacy_level);
    }
    for (const idea of extraction.ideas) {
      await insertIdea(db, capture.id, idea);
    }
    for (const place of extraction.places) {
      await insertPlace(db, capture.id, place, extraction.privacy_level);
    }
    for (const reminder of extraction.reminders) {
      const id = await insertReminder(db, capture.id, reminder, extraction.privacy_level);
      reminderRows.push({ id, reminder });
    }
    for (const interest of extraction.interests) {
      await upsertInterest(db, interest);
    }
    for (const person of extraction.people) {
      await upsertPerson(db, person, extraction.summary);
      void updatePersonContext(db, person, capture.raw_transcript);
    }
    for (const loop of extraction.open_loops) {
      await insertOpenLoop(db, capture.id, loop.description, extraction.privacy_level);
    }
    for (const fu of extraction.follow_ups) {
      await insertFollowUp(db, capture.id, fu.assignee, fu.action, extraction.privacy_level);
    }
    // Persist mood entry
    if (extraction.mood) {
      await db.runAsync(
        'INSERT INTO mood_entries (capture_id, tone, energy) VALUES (?, ?, ?)',
        capture.id, extraction.mood.tone, extraction.mood.energy,
      );
    }
    for (const clarification of extraction.clarifications) {
      await insertContextRequest(
        db,
        capture.id,
        clarification.snippet,
        clarification.question,
        'LUCY found an unclear detail that may improve future organization.',
      );
    }
    await insertExtractionSnapshot(db, capture.id, extraction);
    await updateCaptureResult(db, capture.id, extraction.privacy_level, extraction.title, formatStructuredMemory(extraction));
    await markCaptureProcessed(db, capture.id);
  });

  writeVaultNote(capture.id, extraction, capture.raw_transcript, capture.source, capture.created_at);

  for (const row of reminderRows) {
    try {
      const notificationId = await scheduleCapturedReminder(row.reminder, extraction.privacy_level, capture.raw_transcript);
      if (notificationId) {
        await markReminderScheduled(db, row.id, notificationId);
      }
    } catch {
      // Persisted captures remain valid if the user declines notifications or scheduling fails.
    }
  }

  const resolvedGaps = extraction.memory_gaps.filter((g) => g.answer && g.confidence !== 'none');
  if (resolvedGaps.length > 0) {
    const guardianNote = resolvedGaps
      .map((g) => `${g.question}\n${g.answer}`)
      .join('\n\n');
    try {
      await updateCaptureGuardianNote(db, capture.id, guardianNote);
    } catch {
      // Non-critical; guardian note is supplementary.
    }
    const notification = resolvedGaps[0].notification ?? resolvedGaps[0].answer ?? '';
    if (notification) {
      try {
        await sendGuardianNotification(notification);
      } catch {
        // Notification failure must not affect the capture.
      }
    }
  }
}

export async function processQueue(onChange?: () => void, maxCaptures = Number.POSITIVE_INFINITY): Promise<number> {
  const db = await getDatabase();
  let processedCount = 0;
  while (processedCount < maxCaptures) {
    const capture = await nextQueuedCapture(db);
    if (!capture) {
      return processedCount;
    }
    await markCaptureProcessing(db, capture.id);
    onChange?.();
    try {
      if (await resolveCompletionFollowUp(db, capture)) {
        processedCount += 1;
        onChange?.();
        continue;
      }
      // Inject related past captures as context for richer extraction
      let transcriptWithContext = capture.raw_transcript;
      if (capture.privacy_level !== 'private') {
        try {
          const relatedCtx = await getRelatedContext(db, capture.raw_transcript, capture.id, 3);
          if (relatedCtx.length > 0) {
            transcriptWithContext = `${capture.raw_transcript}\n\n[Related past memories for context:\n${relatedCtx.join('\n')}]`;
          }
        } catch { /* non-critical */ }
      }

      const extraction = await analyzeTranscript(transcriptWithContext, {
        privacyLevel: capture.privacy_level === 'private' || capture.user_marked_private === 1 ? 'private' : capture.privacy_level,
      });
      await persistExtraction(capture, extraction);

      // Store embedding for this capture (enables future semantic search)
      void storeEmbedding(db, capture.id, capture.raw_transcript);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Processing failed.';
      console.warn(`Capture processing deferred: ${message}`);
      await markCaptureFailed(db, capture.id, message);
    }
    processedCount += 1;
    onChange?.();
  }
  return processedCount;
}
