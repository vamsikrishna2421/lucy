/**
 * Brain Galaxy — LLM classification and life-area seeding.
 *
 * Every processed capture automatically gets placed into the topic tree.
 * On the 30th capture, the tree is proposed to the user for approval.
 */

import type { SQLiteDatabase } from 'expo-sqlite';
import { getSetting, setSetting } from '../db/settings';
import { promptAI } from '../ai/openai';
import { resolveRemoteAvailability } from '../ai/provider';
import { isAiCallCapReached, recordAiCall } from '../ai/rateLimit';
import {
  ensureMiscTopic, hasBrainGalaxyBeenSeeded, insertTopic, insertTopicItem,
  listTopics, recordSeedingRun, type BrainTopicRow,
} from '../db/brainTopics';
import { jsonrepair } from 'jsonrepair';

const SEEDING_THRESHOLD = 30; // number of processed captures before proposing tree
const CLASSIFY_SETTING = 'brain_classify_enabled';

// ─── Prompts ──────────────────────────────────────────────────────────────────

const CLASSIFY_SYSTEM = `You are LUCY's memory organizer. Place a captured note into the most specific existing topic.
Rules:
1. Pick the deepest (most specific) matching topic.
2. If ambiguous between two topics, pick the primary subject.
3. If no topic fits well, propose a NEW path as slash-separated string (e.g. "Personal / Housing").
4. confidence: 0.0–1.0. ≥0.8 = auto-place. 0.5–0.79 = place with low-confidence flag. <0.5 = Misc.
5. Return ONLY valid JSON. No explanation.
{"topic_id":12,"new_path":null,"confidence":0.87,"reason":"one short sentence"}`;

const SEED_SYSTEM = `You are LUCY's life architect. Propose a personal topic tree from captured notes.
Rules: 3–7 Life Areas with evidence (Work, Personal, Health, Finance, etc). 2–5 sub-topics each.
Only include areas actually evidenced in the notes. Return ONLY valid JSON.
{"areas":[{"name":"Work","emoji":"💼","topics":[{"name":"Projects"},{"name":"Job Search"}]}]}`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function serializeTopicTree(topics: BrainTopicRow[]): string {
  return topics
    .map((t) => `[${t.id}] ${'  '.repeat(t.depth)}${t.emoji ?? ''} ${t.name}`)
    .join('\n');
}

function extractJSON(raw: string): string {
  const s = raw.indexOf('{');
  const e = raw.lastIndexOf('}');
  return s !== -1 && e !== -1 ? raw.slice(s, e + 1) : raw;
}

// ─── Classification ───────────────────────────────────────────────────────────

export async function classifyItem(
  db: SQLiteDatabase,
  tableName: string,
  rowId: number,
  text: string,
): Promise<void> {
  if (await getSetting(db, CLASSIFY_SETTING) === 'false') return;
  if (await isAiCallCapReached(db)) return;

  const topics = await listTopics(db);
  if (topics.length === 0) {
    // No tree yet — drop into Misc until seeding happens
    const miscId = await ensureMiscTopic(db);
    await insertTopicItem(db, miscId, tableName, rowId, 0.5, 'migration');
    return;
  }

  const { available, openAIKey } = await resolveRemoteAvailability();
  if (!available) {
    const miscId = await ensureMiscTopic(db);
    await insertTopicItem(db, miscId, tableName, rowId, 0.5, 'migration');
    return;
  }

  try {
    const input = `EXISTING TOPICS:\n${serializeTopicTree(topics)}\n\nNOTE:\n${text.slice(0, 400)}`;
    const raw = await promptAI(CLASSIFY_SYSTEM, input, openAIKey, 'classify');
    void recordAiCall(db);

    let parsed: { topic_id?: number | null; new_path?: string | null; confidence?: number; reason?: string } = {};
    try { parsed = JSON.parse(jsonrepair(extractJSON(raw))); } catch { /* use defaults */ }

    const confidence = parsed.confidence ?? 0.4;

    if (parsed.topic_id && confidence >= 0.5) {
      const topic = topics.find((t) => t.id === parsed.topic_id);
      if (topic) {
        await insertTopicItem(db, topic.id, tableName, rowId, confidence, 'llm');
        return;
      }
    }

    if (parsed.new_path && confidence >= 0.6) {
      // Create the proposed path as nested topics
      const parts = (parsed.new_path as string).split('/').map((p) => p.trim()).filter(Boolean);
      let parentId: number | null = null;
      // Try to match existing top-level topics first
      for (const part of parts) {
        const existing = topics.find(
          (t) => t.name.toLowerCase() === part.toLowerCase() && t.parent_id === parentId,
        );
        if (existing) {
          parentId = existing.id;
        } else {
          parentId = await insertTopic(db, part, parentId);
        }
      }
      if (parentId) {
        await insertTopicItem(db, parentId, tableName, rowId, confidence, 'llm');
        return;
      }
    }

    // Low confidence or no match → Misc
    const miscId = await ensureMiscTopic(db);
    await insertTopicItem(db, miscId, tableName, rowId, confidence, 'llm');
  } catch {
    const miscId = await ensureMiscTopic(db);
    await insertTopicItem(db, miscId, tableName, rowId, 0.3, 'llm').catch(() => {});
  }
}

// ─── Seeding ──────────────────────────────────────────────────────────────────

/** True if the 30-capture threshold has been reached and seeding hasn't happened yet. */
export async function shouldSeedBrainGalaxy(db: SQLiteDatabase): Promise<boolean> {
  if (await hasBrainGalaxyBeenSeeded(db)) return false;
  if (await getSetting(db, 'brain_galaxy_seed_shown') === 'true') return false;
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM captures WHERE processed = 1 AND archived_at IS NULL',
  );
  return Number(row?.n ?? 0) >= SEEDING_THRESHOLD;
}

/** Generate the proposed life-area tree from the user's captures. */
export async function generateSeedProposal(db: SQLiteDatabase): Promise<string | null> {
  const { available, openAIKey } = await resolveRemoteAvailability();
  if (!available) return null;
  if (await isAiCallCapReached(db)) return null;

  const evidence = await db.getAllAsync<{ extracted_title: string | null }>(
    'SELECT extracted_title FROM captures WHERE processed = 1 AND archived_at IS NULL ORDER BY created_at DESC LIMIT 60',
  );
  const notesBlob = evidence
    .map((r) => r.extracted_title)
    .filter(Boolean)
    .join('\n');
  if (notesBlob.length < 50) return null;

  try {
    const raw = await promptAI(SEED_SYSTEM, notesBlob, openAIKey, 'insight');
    void recordAiCall(db);
    const captureCount = evidence.length;
    await recordSeedingRun(db, captureCount, raw, 'pending');
    return raw;
  } catch {
    return null;
  }
}

/** Accept a proposed seed (from JSON string) and build the topic tree. */
export async function acceptSeedProposal(db: SQLiteDatabase, proposedJson: string): Promise<void> {
  // Always create Misc first
  await ensureMiscTopic(db);

  let parsed: { areas?: Array<{ name: string; emoji?: string; topics?: Array<{ name: string }> }> } = {};
  try { parsed = JSON.parse(jsonrepair(extractJSON(proposedJson))); } catch { return; }

  for (const area of parsed.areas ?? []) {
    const areaId = await insertTopic(db, area.name, null, area.emoji ?? null);
    for (const topic of area.topics ?? []) {
      await insertTopic(db, topic.name, areaId);
    }
  }

  await setSetting(db, 'brain_galaxy_seed_shown', 'true');
  // Mark the most recent pending seeding run as accepted
  await db.runAsync(
    "UPDATE topic_seeding_runs SET status = 'accepted' WHERE status = 'pending' ORDER BY id DESC LIMIT 1",
  );
}
