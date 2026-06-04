/**
 * Listen Digest — end-of-day insight synthesis from all passive audio captures.
 *
 * Stitches all passive captures from a given date (or today) into a single LLM call
 * that surfaces themes, patterns, tasks, and observations the user might have missed
 * when reviewing individual 30-second clips.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

const DIGEST_PROMPT = `You are LUCY, a personal AI second-brain assistant. The user has captured ambient audio throughout the day using a background microphone. Below are all the transcribed snippets in chronological order.

Synthesize these into a "Listen Digest" with:

THEMES: 2-4 main topics that came up repeatedly today
DECISIONS & INSIGHTS: Key conclusions or observations mentioned
TASKS SPOTTED: Anything that sounds like it needs follow-up
YOUR DAY PATTERN: One sentence observing the overall feel or pace of the day

Be specific — reference actual things said. Skip generic filler. Max 250 words total.
Format: use each section heading on its own line, then bullet points. Plain text only.`;

export interface ListenDigestResult {
  date: string;
  captureCount: number;
  wordCount: number;
  digest: string;
  sessionIds: string[];
}

export async function generateListenDigest(
  db: SQLiteDatabase,
  dateKey?: string, // 'YYYY-MM-DD', defaults to today
): Promise<ListenDigestResult | null> {
  const target = dateKey ?? new Date().toISOString().slice(0, 10);
  const dayStart = `${target}T00:00:00.000Z`;
  const dayEnd = `${target}T23:59:59.999Z`;

  // Fetch all passive captures for the target day
  const rows = await db.getAllAsync<{ id: number; raw_transcript: string; created_at: string; listen_session_id: string | null }>(
    `SELECT id, raw_transcript, created_at, listen_session_id
     FROM captures
     WHERE source = 'passive'
       AND archived_at IS NULL
       AND raw_transcript NOT LIKE '[Voice clip%'
       AND (created_at >= ? OR created_at >= ?)
       AND (created_at <= ? OR created_at <= ?)
     ORDER BY created_at ASC`,
    dayStart, target + ' 00:00:00',
    dayEnd, target + ' 23:59:59',
  );

  if (rows.length < 5) return null; // not enough to digest

  const transcripts = rows
    .map((r) => (r.raw_transcript ?? '').trim())
    .filter((t) => t.length > 0);
  const stitched = transcripts.join('\n---\n');
  const wordCount = stitched.split(/\s+/).length;
  const sessionIds = [...new Set(rows.map((r) => r.listen_session_id).filter(Boolean) as string[])];

  const { resolveRemoteAvailability } = await import('../ai/provider');
  const { promptAI } = await import('../ai/openai');
  const { promptDevice } = await import('../ai/device');

  const { available, openAIKey } = await resolveRemoteAvailability();
  const input = `DATE: ${target}\nCAPTURES: ${rows.length} clips\n\n${stitched.slice(0, 8000)}`;

  let digest: string;
  try {
    if (available) {
      digest = await promptAI(DIGEST_PROMPT, input, openAIKey);
    } else {
      digest = await promptDevice(`${DIGEST_PROMPT}\n\n${input}`);
    }
  } catch {
    return null;
  }

  if (!digest?.trim()) return null;

  // Save as a special passive capture so it appears in the Listen tab as a digest
  const { enqueueTranscript } = await import('./extract');
  const digestText = `[LISTEN DIGEST — ${target}]\n\n${digest}`;
  await enqueueTranscript(digestText, 'passive', false, `digest_${target}`);

  return { date: target, captureCount: rows.length, wordCount, digest, sessionIds };
}

export async function hasUnsummarizedListenCaptures(
  db: SQLiteDatabase,
  dateKey?: string,
): Promise<number> {
  const target = dateKey ?? new Date().toISOString().slice(0, 10);
  const result = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM captures
     WHERE source = 'passive'
       AND archived_at IS NULL
       AND raw_transcript NOT LIKE '[Voice clip%'
       AND raw_transcript NOT LIKE '[LISTEN DIGEST%'
       AND (created_at >= ? OR created_at >= ?)`,
    `${target}T00:00:00.000Z`, `${target} 00:00:00`,
  );
  return result?.n ?? 0;
}
