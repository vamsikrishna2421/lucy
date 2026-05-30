/**
 * HealthKit Insights
 *
 * Pulls step data from expo-sensors Pedometer (iOS/Android, managed workflow).
 * On iOS, if @kingstinct/react-native-healthkit is installed and authorized,
 * also pulls sleep + resting heart rate.
 *
 * Generates structured insights that appear in the Ask → Insights panel.
 */

import type { GeneratedInsight } from './insightEngine';

interface HealthSnapshot {
  stepsToday: number;
  stepsYesterday: number;
  stepsWeekAvg: number;
  sleepHoursLastNight: number | null;
  restingHR: number | null;
  activeMinutesToday: number | null;
}

async function fetchPedometerSteps(): Promise<{ today: number; yesterday: number; weekAvg: number }> {
  try {
    const { Pedometer } = await import('expo-sensors');
    const available = await Pedometer.isAvailableAsync();
    if (!available) return { today: 0, yesterday: 0, weekAvg: 0 };

    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const yesterdayEnd = new Date(todayStart);

    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - 7);

    const [todayResult, yesterdayResult, weekResult] = await Promise.all([
      Pedometer.getStepCountAsync(todayStart, now).catch(() => ({ steps: 0 })),
      Pedometer.getStepCountAsync(yesterdayStart, yesterdayEnd).catch(() => ({ steps: 0 })),
      Pedometer.getStepCountAsync(weekStart, now).catch(() => ({ steps: 0 })),
    ]);

    return {
      today: todayResult.steps,
      yesterday: yesterdayResult.steps,
      weekAvg: Math.round(weekResult.steps / 7),
    };
  } catch {
    return { today: 0, yesterday: 0, weekAvg: 0 };
  }
}

async function fetchHealthKitData(): Promise<{ sleepHours: number | null; restingHR: number | null }> {
  try {
    // @kingstinct/react-native-healthkit — optional, graceful fallback
    const HK = require('@kingstinct/react-native-healthkit') as {
      default: {
        requestAuthorization(read: string[], write: string[]): Promise<void>;
        querySleepSamplesForToday(date?: Date): Promise<Array<{ value: string; startDate: string; endDate: string }>>;
        getMostRecentQuantitySample(identifier: string, unit: string): Promise<{ quantity: number } | null>;
      };
    };
    const hk = HK.default;

    await hk.requestAuthorization(
      ['SleepAnalysis', 'RestingHeartRate'],
      [],
    );

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const [sleepSamples, hrSample] = await Promise.all([
      hk.querySleepSamplesForToday(yesterday).catch(() => []),
      hk.getMostRecentQuantitySample('HKQuantityTypeIdentifierRestingHeartRate', 'count/min').catch(() => null),
    ]);

    // Sum inBed + asleep samples
    let totalSleepMs = 0;
    for (const s of sleepSamples) {
      if (s.value === 'ASLEEP' || s.value === 'INBED') {
        totalSleepMs += new Date(s.endDate).getTime() - new Date(s.startDate).getTime();
      }
    }

    return {
      sleepHours: totalSleepMs > 0 ? Math.round((totalSleepMs / 3_600_000) * 10) / 10 : null,
      restingHR: hrSample?.quantity ?? null,
    };
  } catch {
    return { sleepHours: null, restingHR: null };
  }
}

export async function fetchHealthSnapshot(): Promise<HealthSnapshot> {
  const [steps, hkData] = await Promise.all([
    fetchPedometerSteps(),
    fetchHealthKitData(),
  ]);

  return {
    stepsToday: steps.today,
    stepsYesterday: steps.yesterday,
    stepsWeekAvg: steps.weekAvg,
    sleepHoursLastNight: hkData.sleepHours,
    restingHR: hkData.restingHR,
    activeMinutesToday: null,
  };
}

export async function generateHealthInsights(): Promise<GeneratedInsight[]> {
  const snap = await fetchHealthSnapshot();
  const insights: GeneratedInsight[] = [];

  // Steps insight
  if (snap.stepsToday > 0) {
    const pct = snap.stepsWeekAvg > 0 ? Math.round((snap.stepsToday / snap.stepsWeekAvg) * 100) : null;
    let answer = `${snap.stepsToday.toLocaleString()} steps so far today`;
    if (pct !== null) {
      if (pct >= 110) answer += ` — ${pct - 100}% above your weekly average. Strong day.`;
      else if (pct < 80) answer += ` — about ${100 - pct}% below your weekly average of ${snap.stepsWeekAvg.toLocaleString()}. Consider a walk.`;
      else answer += `, close to your weekly average of ${snap.stepsWeekAvg.toLocaleString()}.`;
    }
    insights.push({
      question: "How does today's movement compare to my usual?",
      answer,
      category: 'wellbeing',
      generatedAt: new Date().toISOString(),
    });
  }

  // Sleep insight
  if (snap.sleepHoursLastNight !== null) {
    const hours = snap.sleepHoursLastNight;
    let quality = '';
    if (hours >= 8) quality = "Solid sleep — you're likely well-rested for today.";
    else if (hours >= 6.5) quality = 'Decent sleep. Watch for afternoon energy dips.';
    else quality = 'Below 7 hours. Consider wrapping up early tonight.';

    insights.push({
      question: 'How was my sleep last night?',
      answer: `${hours} hours last night. ${quality}`,
      category: 'wellbeing',
      generatedAt: new Date().toISOString(),
    });
  }

  // Resting HR insight
  if (snap.restingHR !== null) {
    const hr = snap.restingHR;
    let note = '';
    if (hr < 60) note = 'Below 60 bpm — excellent cardiovascular fitness.';
    else if (hr < 75) note = 'Normal range. Your heart is working efficiently.';
    else note = 'Slightly elevated. Stress, caffeine, or reduced sleep can raise resting HR.';

    insights.push({
      question: "What does my resting heart rate tell me?",
      answer: `Most recent resting HR: ${hr} bpm. ${note}`,
      category: 'wellbeing',
      generatedAt: new Date().toISOString(),
    });
  }

  // Steps trend
  if (snap.stepsToday > 0 && snap.stepsYesterday > 0) {
    const diff = snap.stepsToday - snap.stepsYesterday;
    const pctDiff = Math.round(Math.abs(diff / (snap.stepsYesterday || 1)) * 100);
    if (pctDiff >= 15) {
      insights.push({
        question: "Am I moving more or less than yesterday?",
        answer: diff > 0
          ? `${pctDiff}% more steps than yesterday (${snap.stepsYesterday.toLocaleString()} vs ${snap.stepsToday.toLocaleString()} so far). Good momentum.`
          : `${pctDiff}% fewer steps than yesterday so far. You have time to catch up.`,
        category: 'habits',
        generatedAt: new Date().toISOString(),
      });
    }
  }

  return insights;
}
