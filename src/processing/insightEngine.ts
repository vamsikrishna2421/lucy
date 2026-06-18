/**
 * LUCY Insight Engine
 *
 * Once per day, LUCY's LLM synthesizes everything it knows about the user
 * and generates 5-8 genuinely interesting questions it can answer —
 * not generic prompts, but questions specific to what LUCY has actually observed.
 *
 * These appear in an "Insights" panel in the Ask screen.
 * Clicking reveals the pre-computed answer.
 */

import type { SQLiteDatabase } from 'expo-sqlite';
import { getSetting, setSetting } from '../db/settings';
import { listRecentCaptures } from '../db/captures';
import { getCapturePatterns } from '../db/deviceStats';
import { getMoodTrend } from './temporalEngine';
import { getPersonInsights } from './relationshipEngine';
import { getUserProfile, buildUserContextPrefix } from '../db/userProfile';
import { promptAI } from '../ai/openai';
import { resolveRemoteAvailability } from '../ai/provider';
import { getDeviceContext, enrichWithUsagePatterns } from '../ai/deviceContext';

export interface GeneratedInsight {
  question: string;
  answer: string;
  category: 'habits' | 'relationships' | 'progress' | 'wellbeing' | 'memory' | 'device';
  generatedAt: string;
}

const INSIGHTS_KEY = 'generated_insights_cache';
const INSIGHTS_DATE_KEY = 'generated_insights_date';

export async function getStoredInsights(db: SQLiteDatabase): Promise<GeneratedInsight[]> {
  const cached = await getSetting(db, INSIGHTS_KEY);
  if (!cached) return [];
  try {
    return JSON.parse(cached) as GeneratedInsight[];
  } catch {
    return [];
  }
}

export async function generateDailyInsights(db: SQLiteDatabase): Promise<GeneratedInsight[]> {
  const today = new Date().toISOString().slice(0, 10);
  const lastDate = await getSetting(db, INSIGHTS_DATE_KEY);

  // Return cached insights if already generated today
  if (lastDate === today) {
    return getStoredInsights(db);
  }

  const { available, openAIKey: apiKey } = await resolveRemoteAvailability();
  if (!available) return [];

  // Gather all context
  const [captures, patterns, moodTrend, personInsights, profile, deviceCtx] = await Promise.all([
    listRecentCaptures(db, 30),
    getCapturePatterns(db),
    getMoodTrend(db, 14),
    getPersonInsights(db),
    getUserProfile(db),
    getDeviceContext(),
  ]);

  const deviceInfo = await enrichWithUsagePatterns(deviceCtx);
  const userPrefix = buildUserContextPrefix(profile);

  const capturesSummary = captures
    .filter((c) => c.privacy_level !== 'private')
    .slice(0, 15)
    .map((c) => `[${c.extracted_title ?? 'Note'}]: ${c.raw_transcript?.slice(0, 120) ?? ''}`)
    .join('\n');

  const contextStr = [
    `Capture patterns: Most active at ${patterns.topHour}:00, top day is ${patterns.topDay}`,
    `Mood this week: ${moodTrend.dominant} (${Math.round(moodTrend.positiveRatio * 100)}% positive)`,
    `People insights: ${personInsights.join('; ') || 'None yet'}`,
    `Device: ${deviceInfo}`,
    `Recent captures:\n${capturesSummary}`,
  ].join('\n\n');

  const systemPrompt = `${userPrefix}You are LUCY, a personal AI second brain. You have observed the user's thoughts, habits, and patterns for the past 2 weeks.

Generate ONLY genuinely useful observations — between 0 and 5. QUALITY OVER QUANTITY: it is better to return 1 great insight (or an empty array) than to pad with filler. Do NOT invent insights to hit a count. Each is a short question + an answer that actually helps the user — something they might be MISSING, a next step, a risk worth flagging, or a pattern with a concrete suggestion. Specific to what you've observed, grounded only in the context.

Format as JSON array (may be empty []):
[{"question":"...","answer":"...","category":"habits|relationships|progress|wellbeing|memory|device"}]

Rules:
- ONLY include an insight if it is clearly ACTIONABLE or genuinely revealing. If the data is thin or you'd be restating the obvious, return fewer — or [].
- NEVER pad: no "you keep mentioning X", no "you came back to Y", no generic wellness platitudes, no restating that a topic recurs. If you can't say what to DO or what they're overlooking, drop it.
- Good: "You've noted the lease ending three times but no viewing booked — worth scheduling one this week." Bad: "You keep coming back to your apartment search."
- Answers must be ones you CAN support from the context; never invent facts.
- 2-3 sentences max, conversational, specific, first-person. Plain text only — no markdown.`;

  try {
    const raw = await promptAI(systemPrompt, contextStr, apiKey);
    const start = raw.indexOf('[');
    const end   = raw.lastIndexOf(']');
    if (start === -1 || end === -1) return [];

    const parsed = JSON.parse(raw.slice(start, end + 1)) as Array<{
      question: string;
      answer: string;
      category: string;
    }>;

    const insights: GeneratedInsight[] = parsed
      .filter((i) => i.question && i.answer)
      .slice(0, 8)
      .map((i) => ({
        question:    i.question,
        answer:      i.answer,
        category:    (i.category as GeneratedInsight['category']) ?? 'memory',
        generatedAt: new Date().toISOString(),
      }));

    await setSetting(db, INSIGHTS_KEY, JSON.stringify(insights));
    await setSetting(db, INSIGHTS_DATE_KEY, today);
    return insights;
  } catch {
    return [];
  }
}
