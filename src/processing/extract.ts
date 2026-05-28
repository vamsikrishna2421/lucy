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
import { insertTodo } from '../db/todos';
import type { CaptureSource, ExtractionResult } from '../types/extraction';
import { extractExplicitEnglishFact } from './explicitEnglish';
import { resolveCompletionFollowUp } from './followUp';
import { enforcePrivacy, protectByUserChoice, protectCredentialExtraction } from './privacy';
import { repairReminderTimes } from './reminderTime';
import { normalizeExtraction } from './schema';
import { scheduleCapturedReminder, sendGuardianNotification } from './notifications';
import { writeVaultNote } from './vault';
import { formatStructuredMemory } from './structuredMemory';

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
    for (const task of extraction.tasks) {
      await insertTodo(db, capture.id, task, extraction.privacy_level);
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
    }
    for (const loop of extraction.open_loops) {
      await insertOpenLoop(db, capture.id, loop.description, extraction.privacy_level);
    }
    for (const fu of extraction.follow_ups) {
      await insertFollowUp(db, capture.id, fu.assignee, fu.action, extraction.privacy_level);
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
      const extraction = await analyzeTranscript(capture.raw_transcript, {
        privacyLevel: capture.privacy_level === 'private' || capture.user_marked_private === 1 ? 'private' : capture.privacy_level,
      });
      await persistExtraction(capture, extraction);
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
