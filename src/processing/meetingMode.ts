/**
 * LUCY Meeting Mode
 *
 * Wraps passive listening with meeting-specific intelligence:
 * - Named meeting sessions with duration tracking
 * - Meeting-optimized extraction: decisions, action items, questions, attendees
 * - Auto-summary when session ends
 * - Saves meeting as a structured note with full transcript
 */

import type { SQLiteDatabase } from 'expo-sqlite';
import { promptAI } from '../ai/openai';
import { resolveRemoteAvailability } from '../ai/provider';
import { enqueueTranscript } from './extract';
import { getUserProfile, buildUserContextPrefix } from '../db/userProfile';

export interface MeetingSession {
  id: string;
  title: string;
  startedAt: Date;
  endedAt?: Date;
  durationMs?: number;
  transcript: string;
  summary?: MeetingSummary;
}

export interface MeetingSummary {
  headline: string;               // 1 sentence: "Product roadmap discussion with Sam and Priya"
  keyDecisions: string[];         // "We decided to..."
  actionItems: ActionItem[];      // Who does what by when
  openQuestions: string[];        // Things left unresolved
  attendeesMentioned: string[];   // Names mentioned in transcript
  nextSteps: string;              // 1-2 sentence narrative of what happens next
  speakerNotes?: string | null;   // contextual speaker attribution from transcript
  rawTranscript: string;
}

export interface ActionItem {
  task: string;
  owner?: string;
  deadline?: string;
}

const MEETING_SYSTEM_PROMPT = `You are LUCY, extracting structured intelligence from a meeting transcript.
Extract only what was explicitly said — never invent. Output valid JSON only.

Schema:
{
  "headline": "one sentence summary of the meeting",
  "keyDecisions": ["We decided to...", ...],
  "actionItems": [{"task": "...", "owner": "person name or null", "deadline": "date or null"}],
  "openQuestions": ["question that was raised but not resolved", ...],
  "attendeesMentioned": ["Name1", "Name2"],
  "nextSteps": "brief narrative of what happens next",
  "speakerNotes": "if transcript contains 'Sam said...' or 'Priya mentioned...' extract speaker context; otherwise null"
}

Important: look for contextual speaker clues in the transcript (names followed by 'said', 'mentioned', 'agreed', 'disagreed', 'will', etc.) to populate actionItem owners as accurately as possible.`;

export async function generateMeetingSummary(
  transcript: string,
  title: string,
  db: SQLiteDatabase,
): Promise<MeetingSummary | null> {
  const [{ available, openAIKey }, profile] = await Promise.all([resolveRemoteAvailability(), getUserProfile(db)]);
  if (!available) return null;

  // Always attempt if we have an AI key — even a short/empty transcript can produce a minimal summary.
  // Pass a clear placeholder when nothing was captured so the AI at least returns the schema.
  const effectiveTranscript = transcript.trim() || `Meeting titled "${title}" was recorded but no speech was captured.`;

  const userPrefix = buildUserContextPrefix(profile);
  // 16 000-char window covers ~30 min of speech; longer transcripts keep first+last halves.
  const MAX = 16000;
  const clipped = effectiveTranscript.length > MAX
    ? effectiveTranscript.slice(0, MAX / 2) + '\n...[middle section omitted for length]...\n' + effectiveTranscript.slice(-MAX / 2)
    : effectiveTranscript;
  const input = `Meeting title: ${title}\n\nTranscript:\n${clipped}`;

  try {
    const raw = await promptAI(`${userPrefix}${MEETING_SYSTEM_PROMPT}`, input, openAIKey);
    const start = raw.indexOf('{');
    const end   = raw.lastIndexOf('}');
    if (start === -1 || end === -1) return null;

    const parsed = JSON.parse(raw.slice(start, end + 1)) as Omit<MeetingSummary, 'rawTranscript'>;
    return { ...parsed, rawTranscript: transcript };
  } catch {
    return null;
  }
}

export async function saveMeetingToMemory(
  summary: MeetingSummary,
  title: string,
  durationMs: number,
): Promise<void> {
  const durationMin = Math.round(durationMs / 60000);
  const parts: string[] = [
    `Meeting: ${title} (${durationMin} minutes)`,
    summary.headline,
  ];

  if (summary.keyDecisions.length > 0) {
    parts.push(`Decisions: ${summary.keyDecisions.join('; ')}`);
  }
  if (summary.actionItems.length > 0) {
    const items = summary.actionItems
      .map((a) => `${a.task}${a.owner ? ` (${a.owner})` : ''}${a.deadline ? ` by ${a.deadline}` : ''}`)
      .join('; ');
    parts.push(`Action items: ${items}`);
  }
  if (summary.openQuestions.length > 0) {
    parts.push(`Open questions: ${summary.openQuestions.join('; ')}`);
  }
  if (summary.nextSteps) {
    parts.push(`Next steps: ${summary.nextSteps}`);
  }

  // Store structured summary in the dedicated meeting_summaries table so the
  // Meetings brain tab can show rich formatted summaries, not just raw text.
  const db = await (await import('../db')).getDatabase();
  const { insertMeetingSummary } = await import('../db/meetingSummaries');
  await insertMeetingSummary(
    db,
    title || 'Meeting',
    durationMin,
    summary.headline,
    summary.keyDecisions,
    summary.actionItems,
    summary.openQuestions,
    summary.nextSteps ?? null,
    summary.attendeesMentioned,
    summary.rawTranscript ?? null,
  );

  // Enqueue as a 'meeting' capture so it appears in Timeline and NOT in the Listen tab.
  // Pass the meeting name as a hint so extraction preserves it as the title.
  await enqueueTranscript(parts.join('\n'), 'meeting', false);
}

/**
 * Fallback: saves raw meeting transcript when AI summarization is unavailable.
 * The meeting still appears in Brain → Meetings; the user can re-summarize later.
 */
export async function saveRawTranscriptAsMeeting(
  rawTranscript: string,
  title: string,
  durationMs: number,
): Promise<void> {
  const db = await (await import('../db')).getDatabase();
  const { insertMeetingSummary } = await import('../db/meetingSummaries');
  const durationMin = Math.round(durationMs / 60000);
  await insertMeetingSummary(db, title || 'Meeting', durationMin, null, [], [], [], null, [], rawTranscript);
  // Enqueue the raw transcript as a capture so the meeting appears on the Timeline.
  await enqueueTranscript(`Meeting: ${title || 'Meeting'} (${durationMin} min)\n${rawTranscript.slice(0, 500)}`, 'meeting', false);
}
