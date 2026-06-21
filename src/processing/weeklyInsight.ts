import type { SQLiteDatabase } from 'expo-sqlite';
import { getSetting, setSetting } from '../db/settings';
import { listRecentCaptures } from '../db/captures';
import { getOverdueItems, getMoodTrend } from './temporalEngine';
import { getPersonInsights } from './relationshipEngine';
import { sendGuardianNotification } from './notifications';
import { getUserProfile } from '../db/userProfile';
import { promptAI } from '../ai/openai';
import { resolveRemoteAvailability } from '../ai/provider';

const WEEKLY_LAST_SENT_KEY = 'weekly_insight_last_sent';

function thisWeekKey(): string {
  const d = new Date();
  const weekStart = new Date(d);
  weekStart.setDate(d.getDate() - d.getDay());
  return weekStart.toISOString().slice(0, 10);
}

function isSundayEvening(): boolean {
  const now = new Date();
  return now.getDay() === 0 && now.getHours() >= 18 && now.getHours() < 21;
}

export async function weeklyInsightIfDue(db: SQLiteDatabase): Promise<void> {
  if (!isSundayEvening()) return;

  const weekKey = thisWeekKey();
  const lastSent = await getSetting(db, WEEKLY_LAST_SENT_KEY);
  if (lastSent === weekKey) return;

  await generateAndSendWeeklyInsight(db);
  await setSetting(db, WEEKLY_LAST_SENT_KEY, weekKey);
}

async function generateAndSendWeeklyInsight(db: SQLiteDatabase): Promise<void> {
  const [captures, overdueItems, moodTrend, personInsights, profile] = await Promise.all([
    listRecentCaptures(db, 50),
    getOverdueItems(db),
    getMoodTrend(db, 7),
    getPersonInsights(db),
    getUserProfile(db),
  ]);

  const name = profile.name || 'you';

  // Build raw data for LLM synthesis
  const capturesSummary = captures
    .slice(0, 20)
    .map((c) => c.extracted_title ?? c.raw_transcript?.slice(0, 80))
    .filter(Boolean)
    .join('\n');

  const overdueText = overdueItems
    .slice(0, 5)
    .map((i) => `- ${i.text} (${i.ageDays}d old, score ${i.urgencyScore})`)
    .join('\n');

  let insightText = '';

  try {
    const { available, openAIKey } = await resolveRemoteAvailability();
    if (available) {
      const system = `You are LUCY giving ${name} their weekly insight. Write 2-3 sentences in a warm, direct tone. Plain text only, no markdown. Be specific and actionable. Notice patterns, delays, or things worth reflecting on.`;
      const data = `Week captures:\n${capturesSummary}\n\nOverdue items:\n${overdueText}\n\nMood trend: ${moodTrend.dominant} (${Math.round(moodTrend.positiveRatio * 100)}% positive)\n\nRelationship notes: ${personInsights.join('; ')}`;
      insightText = await promptAI(system, data, openAIKey, 'insight');
    }
  } catch { /* fall through to fallback */ }

  if (!insightText) {
    // Fallback: build without LLM
    const parts: string[] = [];
    if (overdueItems.length > 3) {
      parts.push(`You have ${overdueItems.length} items that have been waiting — the oldest being "${overdueItems[0].text}".`);
    }
    if (moodTrend.dominant === 'stressed' || moodTrend.dominant === 'frustrated') {
      parts.push('This week had a stressful tone in your notes — something worth acknowledging.');
    }
    if (personInsights.length > 0) parts.push(personInsights[0]);
    if (parts.length === 0) parts.push('Good week — you captured a lot and stayed organized.');
    insightText = parts.join(' ');
  }

  await sendGuardianNotification(insightText.trim(), { kind: 'weekly-insight' });
}
