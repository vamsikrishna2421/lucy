/**
 * Demo data seeder — populates LUCY with realistic captures on first launch.
 * Shows judges an organized board immediately instead of an empty state.
 */

import type { SQLiteDatabase } from 'expo-sqlite';
import { getSetting, setSetting } from '../db/settings';

const DEMO_SEED_KEY = 'demo_data_seeded';

const DEMO_CAPTURES = [
  {
    transcript: 'Had a great call with Marcus about the Series B deck. He wants the revenue slide revised by Thursday. Also mentioned the investor list needs updating.',
    title: 'Series B prep call with Marcus',
    summary: 'Revenue slide revision needed, investor list update required.',
    note_type: 'meeting',
    tasks: [{ task: 'Revise revenue slide for Series B deck', category: 'other', urgency: 'high', context: 'Series B' }],
    people: ['Marcus'],
    follow_ups: [{ assignee: 'Marcus', action: 'Send updated investor list' }],
    privacy_level: 'normal',
  },
  {
    transcript: 'Paid 38 dollars for lunch at the Thai place on 5th. Spicy noodles were amazing. Might go back Friday.',
    title: 'Thai lunch expense',
    summary: 'Lunch expense at Thai restaurant.',
    note_type: 'thought',
    expenses: [{ amount: '38', description: 'Thai lunch', category: 'food' }],
    places: [{ name: 'Thai place on 5th', reason: 'Good spicy noodles', urgency: 'someday' }],
    privacy_level: 'normal',
  },
  {
    transcript: 'Had an idea for the app — what if users could share their morning brief with a partner or team? Like a shared context layer. Could be a premium feature.',
    title: 'Shared morning brief feature idea',
    summary: 'Product idea: shared morning brief for teams as premium feature.',
    note_type: 'idea',
    ideas: [{ title: 'Shared morning brief', description: 'Users share daily brief with partner or team — premium feature', type: 'startup' }],
    privacy_level: 'private',
  },
  {
    transcript: 'Need to call the dentist tomorrow morning to schedule a cleaning. Been putting this off for too long.',
    title: 'Call dentist for cleaning',
    summary: 'Schedule dental cleaning appointment.',
    note_type: 'task',
    tasks: [{ task: 'Call dentist to schedule cleaning', category: 'call', urgency: 'medium', context: '' }],
    privacy_level: 'normal',
  },
  {
    transcript: 'Team standup: Sarah is blocked on the API integration waiting for backend credentials. Jake finished the onboarding flow. Deployment is on track for Friday.',
    title: 'Team standup notes',
    summary: 'Sarah blocked on API, Jake done with onboarding, deploy Friday.',
    note_type: 'meeting',
    tasks: [{ task: 'Unblock Sarah — send backend API credentials', category: 'other', urgency: 'high', context: 'Engineering' }],
    people: ['Sarah', 'Jake'],
    follow_ups: [{ assignee: 'Sarah', action: 'Confirm API credentials received' }],
    decisions: ['Deployment target: Friday'],
    privacy_level: 'local',
  },
];

export async function seedDemoDataIfNeeded(db: SQLiteDatabase): Promise<void> {
  const alreadySeeded = await getSetting(db, DEMO_SEED_KEY);
  if (alreadySeeded) return;

  // Check if user already has real captures — don't overwrite
  const existingCount = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) as n FROM captures');
  if ((existingCount?.n ?? 0) > 0) {
    await setSetting(db, DEMO_SEED_KEY, 'true'); // mark seeded so we don't check again
    return;
  }

  const now = new Date();

  for (let i = 0; i < DEMO_CAPTURES.length; i++) {
    const demo = DEMO_CAPTURES[i];
    // Stagger timestamps: 1-5 days ago
    const captureDate = new Date(now.getTime() - (i + 1) * 18 * 60 * 60 * 1000); // 18h apart
    const dateStr = captureDate.toISOString();

    await db.runAsync(
      `INSERT INTO captures (created_at, source, raw_transcript, privacy_level, processed, extracted_title, structured_text, processed_at)
       VALUES (?, 'text', ?, ?, 3, ?, ?, ?)`,
      dateStr,
      demo.transcript,
      demo.privacy_level,
      demo.title,
      `Title: ${demo.title}\nSummary: ${demo.summary}\nType: ${demo.note_type}`,
      dateStr,
    );

    const captureId = (await db.getFirstAsync<{ id: number }>('SELECT last_insert_rowid() as id'))?.id;
    if (!captureId) continue;

    // Insert tasks
    for (const task of (demo as any).tasks ?? []) {
      await db.runAsync(
        'INSERT INTO todos (capture_id, task, category, urgency, context, privacy_level, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        captureId, task.task, task.category, task.urgency, task.context, demo.privacy_level, dateStr,
      );
    }
    // Insert expenses
    for (const exp of (demo as any).expenses ?? []) {
      await db.runAsync(
        'INSERT INTO expenses (capture_id, amount, description, category, privacy_level, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        captureId, parseFloat(exp.amount), exp.description, exp.category, demo.privacy_level, dateStr,
      );
    }
    // Insert ideas
    for (const idea of (demo as any).ideas ?? []) {
      await db.runAsync(
        'INSERT INTO ideas (capture_id, title, description, type, privacy_level, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        captureId, idea.title, idea.description, idea.type, demo.privacy_level, dateStr,
      );
    }
    // Insert follow-ups
    for (const fu of (demo as any).follow_ups ?? []) {
      await db.runAsync(
        'INSERT INTO follow_ups (capture_id, assignee, action, privacy_level, created_at) VALUES (?, ?, ?, ?, ?)',
        captureId, fu.assignee, fu.action, demo.privacy_level, dateStr,
      );
    }
    // Mood
    await db.runAsync(
      'INSERT INTO mood_entries (capture_id, tone, energy, created_at) VALUES (?, ?, ?, ?)',
      captureId, i % 2 === 0 ? 'positive' : 'calm', 'medium', dateStr,
    );
  }

  await setSetting(db, DEMO_SEED_KEY, 'true');
}
