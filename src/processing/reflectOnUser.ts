/**
 * Reflection — the "LUCY learns about you" pass.
 *
 * Once per day, LUCY reads recent memories + the signals it already tracks (mood,
 * capture patterns, people) and distills DURABLE facts about the user — their
 * preferences, habits, traits, routines, goals. These are upserted into the
 * Learned Profile (db/learnedProfile.ts) and injected into every future AI call,
 * so LUCY genuinely gets more tailored to the user over time.
 *
 * Cheap (~1 LLM call/day, date-gated) and private (non-private captures only,
 * routed through AIProvider.prompt which applies the Privacy Shield).
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import { getSetting, setSetting } from '../db/settings';
import { listRecentCaptures } from '../db/captures';
import {
  upsertLearnedFact, getInjectableLearnedFacts, decayStaleLearnedFacts,
  type LearnedCategory,
} from '../db/learnedProfile';

const REFLECT_DATE_KEY = 'last_reflection_date';
const VALID: LearnedCategory[] = ['preference', 'habit', 'trait', 'routine', 'goal', 'relationship', 'correction'];

const REFLECTION_SYSTEM =
  'You are LUCY, building a durable profile of ONE user from their own notes. Output ONLY a JSON array ' +
  'of the most reliable, GENERAL facts about this user — their preferences, habits, traits, routines, and goals. ' +
  'Rules: (1) Only durable patterns, NOT one-off events ("met Sam Tuesday" is NOT a fact; "tends to defer gym tasks" IS). ' +
  '(2) Write each as a short third-person statement about the user. (3) Do NOT include other people\'s private details or names. ' +
  '(4) Prefer things that would help LUCY tailor future help. (5) 5-12 items max, highest-signal only. ' +
  'Format: [{"category":"preference|habit|trait|routine|goal","statement":"..."}]. If nothing reliable, return [].';

/**
 * Runs the daily reflection if it hasn't run today. Returns the number of facts
 * upserted (0 if skipped / nothing learned). Never throws.
 */
export async function reflectOnUser(db: SQLiteDatabase, force = false): Promise<number> {
  try {
    // Weekly cadence (cost control): only reflect if it hasn't run in the last 7 days. Manual triggers
    // (Learned Profile panel / web "reflect now") pass force=true to bypass.
    const lastRun = await getSetting(db, REFLECT_DATE_KEY);
    if (!force && lastRun) {
      const daysSince = (Date.now() - new Date(lastRun).getTime()) / 86_400_000;
      if (daysSince < 7) return 0;
    }
    const nowIso = new Date().toISOString();

    const captures = await listRecentCaptures(db, 40);
    const usable = captures.filter((c) => c.privacy_level !== 'private' && (c.raw_transcript ?? '').trim());
    if (usable.length < 4) return 0; // not enough signal yet

    // Reuse the signals LUCY already tracks.
    const [patterns, moodTrend, personInsights, existing] = await Promise.all([
      import('../db/deviceStats').then((m) => m.getCapturePatterns(db)).catch(() => null),
      import('./temporalEngine').then((m) => m.getMoodTrend(db, 14)).catch(() => null),
      import('./relationshipEngine').then((m) => m.getPersonInsights(db)).catch(() => [] as string[]),
      getInjectableLearnedFacts(db, 20),
    ]);

    const capturesSummary = usable.slice(0, 25)
      .map((c) => `- ${c.extracted_title ?? 'Note'}: ${(c.raw_transcript ?? '').slice(0, 140)}`)
      .join('\n');

    const input = [
      existing.length ? `ALREADY KNOWN about the user (reinforce or refine, don't just repeat):\n${existing.map((s) => `- ${s}`).join('\n')}` : null,
      patterns ? `Capture pattern: most active around ${patterns.topHour}:00, top day ${patterns.topDay}.` : null,
      moodTrend ? `Mood (2 weeks): ${moodTrend.dominant}, ${Math.round(moodTrend.positiveRatio * 100)}% positive.` : null,
      personInsights.length ? `People: ${personInsights.join('; ')}` : null,
      `RECENT NOTES:\n${capturesSummary}`,
    ].filter(Boolean).join('\n\n');

    const { AIProvider } = await import('../ai/provider');
    const raw = await AIProvider.prompt(REFLECTION_SYSTEM, input, 'insight');
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start === -1 || end === -1) { await setSetting(db, REFLECT_DATE_KEY, nowIso); return 0; }

    let parsed: Array<{ category?: string; statement?: string }> = [];
    try { parsed = JSON.parse(raw.slice(start, end + 1)); } catch { parsed = []; }

    // Count only genuinely NEW facts — reinforcing a fact LUCY already knows isn't "learning
    // something new", and reporting it as such was the misleading reflect:N label.
    let learned = 0;
    for (const item of parsed.slice(0, 12)) {
      const statement = (item.statement ?? '').trim();
      if (!statement) continue;
      const category = (VALID.includes(item.category as LearnedCategory) ? item.category : 'trait') as LearnedCategory;
      const isNew = await upsertLearnedFact(db, category, statement, 'reflection');
      if (isNew) learned += 1;
    }

    await decayStaleLearnedFacts(db);
    await setSetting(db, REFLECT_DATE_KEY, nowIso);
    return learned;
  } catch {
    return 0;
  }
}
