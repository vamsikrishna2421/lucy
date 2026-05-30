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
import { insertReminder, markReminderScheduled, reminderAlreadyExists } from '../db/reminders';
import { insertTodo, listPendingTodos } from '../db/todos';
import type { CaptureSource, ExtractionResult } from '../types/extraction';
import { extractExplicitEnglishFact } from './explicitEnglish';
import { resolveCompletionFollowUp } from './followUp';
import { protectByUserChoice } from './privacy';
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
  // Always use remote AI — on-device model disconnected until further notice.
  // localOnly flag is intentionally ignored.
  const privacyLevel = options.privacyLevel ?? 'normal';
  const explicitFact = extractExplicitEnglishFact(trimmed);
  const result = explicitFact
    ? normalizeExtraction(explicitFact)
    : await AIProvider.analyze(trimmed, privacyLevel);

  // Credential auto-detection disabled — user manually marks sensitive content.
  const extraction = repairReminderTimes(normalizeExtraction(result), trimmed);
  if (privacyLevel === 'private') {
    extraction.privacy_level = 'private';
  }
  if (!hasMeaningfulExtraction(extraction)) {
    // For questions / device queries, don't retry — just store with a note summary
    const isQuestion = trimmed.trim().endsWith('?') || /^(what|where|when|who|why|how|is|are|do|does|can|will)\b/i.test(trimmed.trim());
    if (isQuestion) {
      return {
        ...extraction,
        title: extraction.title !== 'Untitled capture' ? extraction.title : trimmed.slice(0, 60),
        summary: 'Routed to Ask — use the Ask tab to get answers from your memory.',
        open_loops: [{ description: trimmed, urgency: 'none' as const }],
      };
    }
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

  // Detect multi-date journal: split into separate historical captures
  if (source === 'text' && trimmed.length > 200) {
    try {
      const { isMultiDateJournal, ingestJournal } = await import('./journalSplitter');
      if (isMultiDateJournal(trimmed)) {
        const count = await ingestJournal(db, trimmed, preflight.level);
        if (count >= 3) return count;
      }
    } catch { /* fall through */ }

    // Split multiple distinct thoughts into separate captures
    try {
      const { shouldSplitThoughts, splitThoughts } = await import('./thoughtSplitter');
      if (shouldSplitThoughts(trimmed)) {
        const thoughts = splitThoughts(trimmed);
        if (thoughts.length >= 2) {
          let lastId = 0;
          for (const thought of thoughts) {
            lastId = await insertCapture(db, source, thought, preflight.level, markedPrivate);
            // Apply temporal anchor to each thought
            const { extractTemporalAnchor } = await import('./temporalAnchor');
            const anchor = extractTemporalAnchor(thought);
            if (anchor) {
              await db.runAsync('UPDATE captures SET created_at = ? WHERE id = ?', anchor.toISOString(), lastId);
            }
          }
          return lastId;
        }
      }
    } catch { /* fall through */ }
  }

  // Single capture — apply temporal anchor if date mentioned
  const id = (source === 'android' || source === 'ios')
    ? await insertSharedCapture(db, source, trimmed, preflight.level, markedPrivate)
    : await insertCapture(db, source, trimmed, preflight.level, markedPrivate);

  try {
    const { extractTemporalAnchor } = await import('./temporalAnchor');
    const anchor = extractTemporalAnchor(trimmed);
    if (anchor) {
      await db.runAsync('UPDATE captures SET created_at = ? WHERE id = ?', anchor.toISOString(), id);
    }
  } catch { /* non-critical */ }

  return id;
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
      const isDupe = await reminderAlreadyExists(db, reminder.text);
      if (isDupe) continue;
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

/**
 * Splits large text into logical chunks and processes each independently,
 * then merges all ExtractionResults into one. This is LUCY's "agent parallelism" —
 * each chunk is a separate LLM call (worker), results are unified at the end.
 *
 * Splits on paragraph breaks, preferring ~600-word chunks so each
 * call is fast and within token limits.
 */
async function chunkAndMergeExtract(
  text: string,
  privacyLevel: 'private' | 'local' | 'normal',
): Promise<ExtractionResult> {
  const WORDS_PER_CHUNK = 600;
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 10);
  const chunks: string[] = [];
  let current: string[] = [];
  let wordCount = 0;

  for (const para of paragraphs) {
    const words = para.trim().split(/\s+/).length;
    if (wordCount + words > WORDS_PER_CHUNK && current.length > 0) {
      chunks.push(current.join('\n\n'));
      current = [para];
      wordCount = words;
    } else {
      current.push(para);
      wordCount += words;
    }
  }
  if (current.length > 0) chunks.push(current.join('\n\n'));

  // If still only one chunk (no paragraph breaks), force-split by word count
  if (chunks.length <= 1) {
    const words = text.split(/\s+/);
    const forcedChunks: string[] = [];
    for (let i = 0; i < words.length; i += WORDS_PER_CHUNK) {
      forcedChunks.push(words.slice(i, i + WORDS_PER_CHUNK).join(' '));
    }
    chunks.splice(0, chunks.length, ...forcedChunks);
  }

  // Process each chunk (sequential to respect rate limits)
  const results: ExtractionResult[] = [];
  for (let i = 0; i < chunks.length; i++) {
    try {
      const chunkLabel = chunks.length > 1 ? `[Part ${i + 1} of ${chunks.length}]\n` : '';
      const result = await analyzeTranscript(chunkLabel + chunks[i], { privacyLevel });
      results.push(result);
    } catch { /* skip failed chunks — partial extraction is better than none */ }
  }

  if (results.length === 0) throw new Error('All chunks failed to extract.');
  if (results.length === 1) return results[0];

  // Merge all results into the first one
  const merged = { ...results[0] };
  for (const r of results.slice(1)) {
    merged.tasks = [...merged.tasks, ...r.tasks];
    merged.expenses = [...merged.expenses, ...r.expenses];
    merged.ideas = [...merged.ideas, ...r.ideas];
    merged.places = [...merged.places, ...r.places];
    merged.people = [...new Set([...merged.people, ...r.people])];
    merged.interests = [...merged.interests, ...r.interests];
    merged.decisions = [...merged.decisions, ...r.decisions];
    merged.reminders = [...merged.reminders, ...r.reminders];
    merged.open_loops = [...merged.open_loops, ...r.open_loops];
    merged.follow_ups = [...merged.follow_ups, ...r.follow_ups];
    merged.tags = [...new Set([...merged.tags, ...r.tags])];
    merged.clarifications = [...merged.clarifications, ...r.clarifications];
    merged.memory_gaps = [...merged.memory_gaps, ...r.memory_gaps];
    if (!merged.summary && r.summary) merged.summary = r.summary;
    if (merged.title === 'Untitled capture' && r.title !== 'Untitled capture') merged.title = r.title;
  }
  // Better title for chunked captures
  if (merged.title === 'Untitled capture' || merged.title.startsWith('[Part')) {
    merged.title = `${chunks.length}-part journal — ${merged.tasks.length} tasks, ${merged.people.length} people`;
  }
  return merged;
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

      const isPrivate = capture.privacy_level === 'private' || capture.user_marked_private === 1;
      const privacyLevel = isPrivate ? 'private' : (capture.privacy_level as 'private' | 'local' | 'normal');

      // Large captures (>3000 chars) get chunked into parallel agent extractions then merged
      const CHUNK_THRESHOLD = 3000;
      const rawText = capture.raw_transcript ?? '';
      let extraction;
      if (rawText.length > CHUNK_THRESHOLD) {
        extraction = await chunkAndMergeExtract(rawText, privacyLevel);
      } else {
        extraction = await analyzeTranscript(transcriptWithContext, { privacyLevel });
      }
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
