import type { SQLiteDatabase } from 'expo-sqlite';
import { getSetting, setSetting } from '../db/settings';
import { getOverdueItems, getRelationshipGaps, getMoodTrend } from './temporalEngine';
import { getPersonInsights } from './relationshipEngine';
import { countOpenLoops } from '../db/openLoops';
import { countFollowUps } from '../db/followUps';
import { sendGuardianNotification } from './notifications';
import { getUserProfile } from '../db/userProfile';
import { promptAI } from '../ai/openai';
import { resolveRemoteAvailability } from '../ai/provider';

const BRIEF_LAST_SENT_KEY = 'morning_brief_last_sent';

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

async function buildBriefWithLLM(db: SQLiteDatabase, rawBrief: string, name: string): Promise<string> {
  try {
    const { available, openAIKey } = await resolveRemoteAvailability();
    if (!available) return rawBrief;

    const system = `You are LUCY, a personal AI assistant giving ${name || 'the user'} their morning brief.
Write in a warm, direct, conversational tone — like a trusted friend checking in.
Use plain text only (no markdown, no asterisks). Keep it under 120 words.
Be specific about what matters today. Start with their name.`;

    const result = await promptAI(system, `Morning brief data:\n${rawBrief}\n\nWrite the morning brief now.`, openAIKey);
    return result.trim();
  } catch {
    return rawBrief;
  }
}

export async function sendMorningBrief(db: SQLiteDatabase): Promise<void> {
  const today = todayKey();
  const lastSent = await getSetting(db, BRIEF_LAST_SENT_KEY);
  if (lastSent === today) return; // Already sent today

  const [
    overdueItems,
    relationshipGaps,
    moodTrend,
    personInsights,
    openLoopCount,
    followUpCount,
    profile,
  ] = await Promise.all([
    getOverdueItems(db),
    getRelationshipGaps(db),
    getMoodTrend(db, 7),
    getPersonInsights(db),
    countOpenLoops(db),
    countFollowUps(db),
    getUserProfile(db),
  ]);

  const name = profile.name || 'you';
  const parts: string[] = [];

  // High-urgency overdue items
  const critical = overdueItems.filter((i) => i.urgencyScore >= 7).slice(0, 3);
  if (critical.length > 0) {
    parts.push(`${critical.length} critical item${critical.length > 1 ? 's' : ''} need attention: ${critical.map((i) => i.text).join(', ')}.`);
  }

  // Open loops and follow-ups
  if (openLoopCount > 0 || followUpCount > 0) {
    const items: string[] = [];
    if (openLoopCount > 0) items.push(`${openLoopCount} loose end${openLoopCount > 1 ? 's' : ''}`);
    if (followUpCount > 0) items.push(`${followUpCount} follow-up${followUpCount > 1 ? 's' : ''}`);
    parts.push(`${items.join(' and ')} still waiting.`);
  }

  // Relationship gaps
  if (personInsights.length > 0) {
    parts.push(personInsights[0]);
  }

  // Mood trend
  if (moodTrend.recentTones.length > 0) {
    const stressed = moodTrend.recentTones.filter((t) => ['stressed', 'frustrated', 'negative'].includes(t)).length;
    if (stressed >= 3) {
      parts.push('Your notes this week have had a stressed tone — worth noticing.');
    } else if (moodTrend.dominant === 'positive' || moodTrend.dominant === 'excited') {
      parts.push('Your energy has been positive lately — keep it up.');
    }
  }

  // Health tip for the morning
  try {
    const { getTodayHealthSnapshot } = await import('../db/healthSnapshots');
    const { generateHealthTip } = await import('./recordLifeContext');
    const health = await getTodayHealthSnapshot(db);
    if (health) {
      const tip = generateHealthTip(health.steps, health.sleep_hours, health.resting_hr);
      if (tip) parts.push(tip);
    }
  } catch { /* non-critical */ }

  // Top Brain Galaxy life area context
  try {
    const { listTopics } = await import('../db/brainTopics');
    const topics = await listTopics(db);
    const topArea = topics.filter((t) => t.depth === 0 && !t.is_misc).sort((a, b) => b.item_count - a.item_count)[0];
    if (topArea && topArea.item_count > 5) {
      parts.push(`Most of your captured memories cluster around ${topArea.name}.`);
    }
  } catch { /* non-critical */ }

  if (parts.length === 0) {
    parts.push('Your board is clear and you\'re up to date. Good start to the day.');
  }

  const rawBrief = parts.join(' ');
  const briefText = await buildBriefWithLLM(db, rawBrief, name);

  await sendGuardianNotification(briefText, { kind: 'morning-brief' });
  await setSetting(db, BRIEF_LAST_SENT_KEY, today);
}

export async function shouldSendMorningBrief(): Promise<boolean> {
  const now = new Date();
  const hour = now.getHours();
  // Send between 7am and 9am
  return hour >= 7 && hour < 9;
}
