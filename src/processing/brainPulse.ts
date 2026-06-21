/**
 * LUCY Pulse — 6-hour cross-domain brain synthesis.
 *
 * Gathers a 7-day rolling window of captures, todos, expenses, people, mood,
 * and meetings, then asks the LLM to find cross-domain patterns the user has NOT
 * explicitly asked about: connections between data types, anomalies, momentum signals.
 *
 * Distinct from:
 *   Morning Brief — daily triage of what needs doing
 *   Weekly Insight — retrospective Sunday summary
 *   Daily Insights — Q&A pairs in the Ask screen
 * Pulse is the only feature that synthesizes *across all data types continuously*.
 */

import type { SQLiteDatabase } from 'expo-sqlite';
import { getSetting, setSetting } from '../db/settings';
import { promptAI } from '../ai/openai';
import { resolveRemoteAvailability } from '../ai/provider';
import { getUserProfile, buildUserContextPrefix } from '../db/userProfile';
import { insertBrainPulse, pruneOldPulses } from '../db/brainPulses';
import { recordAiCall, isAiCallCapReached } from '../ai/rateLimit';
import { daysSinceDb } from '../utils/datetime';

const PULSE_LAST_RUN_KEY = 'brain_pulse_last_run';
const PULSE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // weekly (cost control; was 6h)
const MIN_CAPTURES_SINCE_LAST = 3; // don't run if user has been inactive

interface PulseSignal {
  category: 'pattern' | 'person' | 'mood' | 'connection' | 'overdue';
  headline: string;
}

interface PulseResponse {
  signals: PulseSignal[];
}

const BRAIN_PULSE_SYSTEM = `You are LUCY, a personal second brain. You run a quiet 6-hour brain scan.

Your only job: find 2-4 things worth noticing that the user has NOT already seen in a regular morning brief.

Focus on:
1. CROSS-DOMAIN CONNECTIONS — an idea that relates to a meeting, a person who connects to a task, a music pattern that mirrors mood
2. ANOMALIES — something unusual compared to the user's recent patterns (expense spike, unusual silence from someone, a task aging fast)
3. MOMENTUM SIGNALS — something building (an idea mentioned across 3+ captures, a project gaining momentum, a positive mood streak)
4. RELATIONSHIP GAPS — people mentioned frequently but no follow-up logged

Rules:
- Never repeat generic things like "you have overdue tasks" unless it is a specific pattern worth noting.
- Be specific. Reference actual names, amounts, or topics from the data.
- Each signal is one plain-text sentence. No markdown. No bullet symbols. No emojis.
- If there is nothing genuinely new or interesting, return an empty signals array — do not invent.
- Return JSON only: {"signals":[{"category":"pattern|person|mood|connection|overdue","headline":"..."}]}`;

export async function runBrainPulseIfDue(db: SQLiteDatabase): Promise<number> {
  const hour = new Date().getHours();
  // Night suppression: skip 11pm–7am — morning brief covers the wakeup window.
  if (hour >= 23 || hour < 7) return 0;

  // Rate limit guard
  if (await isAiCallCapReached(db)) return 0;

  // Interval guard — only run if enough time has passed.
  const lastRun = await getSetting(db, PULSE_LAST_RUN_KEY);
  if (lastRun) {
    const elapsed = Date.now() - new Date(lastRun).getTime();
    if (elapsed < PULSE_INTERVAL_MS) return 0;
  }

  // Minimum-data guard — need recent activity to have anything to synthesize.
  const recentCount = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM captures WHERE created_at >= datetime('now', '-6 hours') AND processed = 1 AND archived_at IS NULL`,
  );
  if (Number(recentCount?.n ?? 0) < MIN_CAPTURES_SINCE_LAST) {
    // Don't stamp the run time so we try again in the next background window.
    return 0;
  }

  const { available, openAIKey } = await resolveRemoteAvailability();
  if (!available) return 0;

  // Build context from 7-day rolling window.
  const context = await buildPulseContext(db);
  const profile = await getUserProfile(db);
  const userPrefix = buildUserContextPrefix(profile);

  let parsed: PulseResponse = { signals: [] };
  try {
    const raw = await promptAI(`${userPrefix}${BRAIN_PULSE_SYSTEM}`, context, openAIKey, 'insight');
    void recordAiCall(db);
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start !== -1 && end !== -1) {
      parsed = JSON.parse(raw.slice(start, end + 1)) as PulseResponse;
    }
  } catch { /* generation failed — skip */ }

  await setSetting(db, PULSE_LAST_RUN_KEY, new Date().toISOString());

  if (!parsed.signals || parsed.signals.length === 0) return 0;

  // Deduplicate against the most recent pulse — skip if identical.
  const { listUnseenPulses } = await import('../db/brainPulses');
  const existing = await listUnseenPulses(db);
  const latestHeadlines = new Set(existing.slice(0, 4).map((p) => p.headline.toLowerCase().slice(0, 60)));
  const fresh = parsed.signals.filter((s) => !latestHeadlines.has(s.headline.toLowerCase().slice(0, 60)));
  if (fresh.length === 0) return 0;

  for (const signal of fresh.slice(0, 4)) {
    await insertBrainPulse(db, signal.category ?? 'pattern', signal.headline);
  }

  await pruneOldPulses(db);
  return fresh.length;
}

async function buildPulseContext(db: SQLiteDatabase): Promise<string> {
  const parts: string[] = [];

  // Recent captures (7-day, non-private, title + snippet)
  const captures = await db.getAllAsync<{ extracted_title: string | null; raw_transcript: string; created_at: string }>(
    `SELECT extracted_title, raw_transcript, created_at FROM captures
     WHERE processed = 1 AND privacy_level = 'normal' AND archived_at IS NULL
       AND created_at >= datetime('now', '-7 days')
     ORDER BY created_at DESC LIMIT 40`,
  );
  if (captures.length > 0) {
    parts.push('RECENT CAPTURES (last 7 days):');
    parts.push(captures.map((c) => `- ${c.extracted_title ?? c.raw_transcript.slice(0, 80)}`).join('\n'));
  }

  // Pending todos with age
  const todos = await db.getAllAsync<{ task: string; urgency: string; created_at: string }>(
    `SELECT task, urgency, created_at FROM todos WHERE status = 'pending' ORDER BY created_at ASC LIMIT 20`,
  );
  if (todos.length > 0) {
    parts.push('\nPENDING TASKS:');
    parts.push(todos.map((t) => {
      const ageDays = daysSinceDb(t.created_at);
      return `- [${t.urgency}] ${t.task} (${ageDays}d old)`;
    }).join('\n'));
  }

  // Expenses last 30 days grouped by category
  const expenses = await db.getAllAsync<{ category: string; total: number; cnt: number }>(
    `SELECT category, ROUND(SUM(CAST(amount AS REAL)),2) AS total, COUNT(*) AS cnt
     FROM expenses WHERE created_at >= datetime('now', '-30 days') GROUP BY category`,
  );
  if (expenses.length > 0) {
    parts.push('\nEXPENSES (30 days):');
    parts.push(expenses.map((e) => `- ${e.category}: $${e.total ?? 0} (${e.cnt} entries)`).join('\n'));
  }

  // People: mention count + days since last mention + pending follow-ups
  const people = await db.getAllAsync<{ name: string; mention_count: number; typical_context: string | null; pending_follow_ups: number }>(
    `SELECT name, mention_count, typical_context, pending_follow_ups FROM person_contexts ORDER BY mention_count DESC LIMIT 10`,
  );
  if (people.length > 0) {
    parts.push('\nPEOPLE IN YOUR BRAIN:');
    parts.push(people.map((p) => `- ${p.name} (${p.mention_count} mentions, ${p.pending_follow_ups} pending follow-ups)`).join('\n'));
  }

  // Mood entries last 7 days
  const moods = await db.getAllAsync<{ tone: string; created_at: string }>(
    `SELECT tone, created_at FROM mood_entries WHERE created_at >= datetime('now', '-7 days') ORDER BY created_at DESC LIMIT 14`,
  );
  if (moods.length > 0) {
    parts.push('\nMOOD TREND (last 7 days):');
    parts.push(moods.map((m) => m.tone).join(', '));
  }

  // Open loops count
  const loops = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM open_loops WHERE status = 'open'`,
  );
  if (Number(loops?.n ?? 0) > 0) {
    parts.push(`\nOPEN LOOPS: ${loops!.n} unresolved`);
  }

  // Follow-ups pending
  const followUps = await db.getAllAsync<{ assignee: string; action: string }>(
    `SELECT assignee, action FROM follow_ups WHERE status = 'pending' ORDER BY created_at ASC LIMIT 5`,
  );
  if (followUps.length > 0) {
    parts.push('\nPENDING FOLLOW-UPS:');
    parts.push(followUps.map((f) => `- ${f.assignee}: ${f.action}`).join('\n'));
  }

  // Recent meeting headlines
  const meetings = await db.getAllAsync<{ title: string; headline: string | null; recorded_at: string }>(
    `SELECT title, headline, recorded_at FROM meeting_summaries ORDER BY recorded_at DESC LIMIT 3`,
  );
  if (meetings.length > 0) {
    parts.push('\nRECENT MEETINGS:');
    parts.push(meetings.map((m) => `- ${m.title}: ${m.headline ?? 'no summary yet'}`).join('\n'));
  }

  // Ideas
  const ideas = await db.getAllAsync<{ title: string; description: string }>(
    `SELECT title, description FROM ideas ORDER BY created_at DESC LIMIT 8`,
  );
  if (ideas.length > 0) {
    parts.push('\nIDEAS:');
    parts.push(ideas.map((i) => `- ${i.title}: ${i.description.slice(0, 80)}`).join('\n'));
  }

  // Health snapshots — last 7 days
  const healthRows = await db.getAllAsync<{ date_key: string; steps: number; sleep_hours: number | null; resting_hr: number | null }>(
    `SELECT date_key, steps, sleep_hours, resting_hr FROM health_snapshots WHERE date_key >= date('now', '-7 days') ORDER BY date_key DESC`,
  );
  if (healthRows.length > 0) {
    parts.push('\nHEALTH (last 7 days):');
    parts.push(healthRows.map((h) => {
      const s = [`${h.date_key}`];
      if (h.steps > 0) s.push(`${h.steps.toLocaleString()} steps`);
      if (h.sleep_hours !== null) s.push(`${h.sleep_hours}h sleep`);
      if (h.resting_hr !== null) s.push(`HR ${h.resting_hr} bpm`);
      return `- ${s.join(', ')}`;
    }).join('\n'));
  }

  // Location snapshots — travel this week
  const locationRows = await db.getAllAsync<{ date_key: string; city: string | null; region: string | null; country: string | null }>(
    `SELECT date_key, city, region, country FROM location_snapshots WHERE date_key >= date('now', '-7 days') ORDER BY date_key DESC`,
  );
  if (locationRows.length > 0) {
    parts.push('\nTRAVEL THIS WEEK:');
    parts.push(locationRows.map((l) => {
      const place = [l.city, l.region, l.country].filter(Boolean).join(', ');
      return `- ${l.date_key}: ${place || 'unknown location'}`;
    }).join('\n'));
  }

  return parts.join('\n');
}
