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
import { getRemoteAccessState, getRemoteOpenAIKey } from '../ai/remoteAccess';
import { promptOpenAI } from '../ai/openai';
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

  const remote = await getRemoteAccessState();
  if (!remote.enabled || !remote.hasKey) return [];

  const apiKey = await getRemoteOpenAIKey();
  if (!apiKey) return [];

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

Generate exactly 6 insightful questions that YOU can already answer based on what you know. These should be genuinely interesting, specific to what you've observed — NOT generic questions.

Format as JSON array:
[{"question":"...","answer":"...","category":"habits|relationships|progress|wellbeing|memory|device"}]

Rules:
- Questions must be ones you CAN answer from the context given
- Answers must be 2-3 sentences max, conversational, specific
- Mix categories (habits, mood/wellbeing, relationships, progress, memory patterns)
- Plain text only in answers — no markdown
- Questions should feel like a friend noticing something about you`;

  try {
    const raw = await promptOpenAI(systemPrompt, contextStr, apiKey);
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
