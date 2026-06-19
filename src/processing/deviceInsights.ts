/**
 * LUCY Device Intelligence
 *
 * Intent: Not screen time statistics, but life intelligence.
 * LUCY connects device behavior to goals, mood, and wellbeing —
 * answering not "what did you do on your phone" but
 * "what does your phone behavior reveal about your life right now?"
 */

import type { SQLiteDatabase } from 'expo-sqlite';
import { getBatteryHistory, getCapturePatterns } from '../db/deviceStats';
import { getMoodTrend } from './temporalEngine';
import { promptAI } from '../ai/openai';
import { resolveRemoteAvailability } from '../ai/provider';
import { getUserProfile, buildUserContextPrefix } from '../db/userProfile';
import { getDatabase } from '../db';

export interface DeviceIntelligenceReport {
  captureRhythm: string;       // e.g., "Most productive mornings, quiets by 6pm"
  batteryPattern: string;      // e.g., "Heaviest drain on Tuesdays"
  moodCorrelation: string;     // e.g., "More captures on positive-tone days"
  topInsight: string;          // The single most actionable insight
  rawStats: {
    topCaptureHour: number;
    topCaptureDay: string;
    avgCapturesPerDay: number;
    totalCapturesThisWeek: number;
    avgBatteryDrain?: number;  // % per hour
  };
}

async function analyzeBatteryPattern(history: Awaited<ReturnType<typeof getBatteryHistory>>) {
  if (history.length < 4) return null;

  // Average drain per day of week
  const drainByDay: Record<number, number[]> = {};
  for (let i = 0; i < history.length - 1; i++) {
    const current = history[i];
    const next    = history[i + 1];
    if (!current.is_charging && !next.is_charging) {
      const drain = next.battery_level - current.battery_level; // negative = drained
      const day   = current.day_of_week;
      if (!drainByDay[day]) drainByDay[day] = [];
      if (drain < 0) drainByDay[day].push(Math.abs(drain));
    }
  }

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  let heaviestDay = -1;
  let heaviestDrain = 0;
  for (const [day, drains] of Object.entries(drainByDay)) {
    const avg = drains.reduce((a, b) => a + b, 0) / drains.length;
    if (avg > heaviestDrain) { heaviestDrain = avg; heaviestDay = Number(day); }
  }

  return {
    heaviestDay: heaviestDay >= 0 ? dayNames[heaviestDay] : null,
    avgDrainPct: heaviestDrain,
  };
}

export async function generateDeviceIntelligence(): Promise<DeviceIntelligenceReport> {
  const db = await getDatabase();
  const [patterns, batteryHistory, moodTrend, profile] = await Promise.all([
    getCapturePatterns(db),
    getBatteryHistory(db, 7),
    getMoodTrend(db, 7),
    getUserProfile(db),
  ]);

  const batteryAnalysis = await analyzeBatteryPattern(batteryHistory);

  // Determine capture rhythm description
  const hour = patterns.topHour;
  const timeLabel = hour < 9 ? 'early morning' : hour < 12 ? 'morning' : hour < 15 ? 'midday' : hour < 18 ? 'afternoon' : 'evening';
  const captureRhythm = patterns.hasData
    ? `Most active ${timeLabel} (${hour}:00), ${patterns.topDay} is your most captured day. About ${patterns.avgPerDay} thought${patterns.avgPerDay !== 1 ? 's' : ''} per day this week.`
    : 'Not enough captures yet this week to call out your active times — your real pattern will emerge as you use LUCY.';

  const batteryPattern = batteryAnalysis?.heaviestDay
    ? `Your phone drains heaviest on ${batteryAnalysis.heaviestDay}s — likely your busiest day.`
    : 'Not enough battery data yet — patterns will emerge over a few days.';

  // Mood correlation
  const moodCorrelation = moodTrend.recentTones.length > 3
    ? moodTrend.positiveRatio > 0.6
      ? 'Your captures this week have been mostly positive — you tend to engage more with LUCY on good days.'
      : moodTrend.positiveRatio < 0.4
        ? 'Your captures show a stressed week. Heavy capture days often follow difficult ones — writing helps.'
        : 'Mixed week — your capture activity does not clearly correlate with mood this week.'
    : 'Capture more regularly to reveal mood-activity patterns.';

  // Generate a top insight using LLM if available
  let topInsight = patterns.hasData
    ? `Your most productive capture window is ${timeLabel} on ${patterns.topDay}. Protect that time for deep thinking.`
    : 'Capture a few more thoughts and LUCY will start surfacing your real rhythms and patterns.';

  try {
    const { available, openAIKey } = await resolveRemoteAvailability();
    if (available) {
      const userPrefix = buildUserContextPrefix(profile);
      const dataStr = `Capture patterns: ${captureRhythm}\nBattery: ${batteryPattern}\nMood: ${moodCorrelation}\nMood dominant: ${moodTrend.dominant}, positive ratio: ${Math.round(moodTrend.positiveRatio * 100)}%`;
      const result = await promptAI(
        `${userPrefix}You are LUCY, a personal AI second brain. Based on the user's device behavior and mental patterns below, give ONE specific, actionable, and empathetic insight in 2 sentences. Not a statistic — an observation about their life. Plain text, no markdown.`,
        dataStr,
        openAIKey,
      );
      if (result.trim()) topInsight = result.trim();
    }
  } catch { /* fall back to default */ }

  return {
    captureRhythm,
    batteryPattern,
    moodCorrelation,
    topInsight,
    rawStats: {
      topCaptureHour: patterns.topHour,
      topCaptureDay: patterns.topDay,
      avgCapturesPerDay: patterns.avgPerDay,
      totalCapturesThisWeek: patterns.totalLast7Days,
      avgBatteryDrain: batteryAnalysis?.avgDrainPct,
    },
  };
}
