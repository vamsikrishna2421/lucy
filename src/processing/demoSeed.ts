/**
 * Demo data seeder — populates the Demo Brain with realistic captures.
 * Data inspired by Eleanor Vance's daily records dataset.
 */

import type { SQLiteDatabase } from 'expo-sqlite';
import { getSetting, setSetting } from '../db/settings';

const DEMO_SEED_KEY = 'demo_data_seeded';

const DEMO_CAPTURES = [
  {
    transcript: 'Big campaign launch today — feeling a mix of excitement and nerves. The client presentation went really well, team was pumped. Need to send the final performance report to Marcus by Thursday. Budget came in 12% under, David wants to celebrate tonight.',
    title: 'Campaign launch day — client win',
    summary: 'Successful campaign launch, report due Thursday, team celebrating.',
    note_type: 'meeting',
    tasks: [
      { task: 'Send final campaign performance report to Marcus', category: 'other', urgency: 'high', context: 'Work' },
      { task: 'Book dinner reservation for team celebration', category: 'other', urgency: 'medium', context: 'Personal' },
    ],
    people: ['Marcus', 'David'],
    follow_ups: [{ assignee: 'Marcus', action: 'Confirm report received and share feedback' }],
    decisions: ['Campaign closed 12% under budget'],
    privacy_level: 'normal',
  },
  {
    transcript: 'Coffee with Sarah this morning. She mentioned the new project management tool rollout is getting pushback from the ops team. I think the root issue is training, not the tool itself. Spent $6.50 on the latte. We need to schedule a proper onboarding session next week.',
    title: 'Coffee with Sarah — PM tool rollout issue',
    summary: 'Ops team resisting new PM tool. Training gap is the root cause.',
    note_type: 'meeting',
    tasks: [
      { task: 'Schedule PM tool onboarding session for ops team', category: 'other', urgency: 'medium', context: 'Work' },
    ],
    expenses: [{ amount: '6.50', description: 'Coffee with Sarah', category: 'food' }],
    people: ['Sarah'],
    ideas: [{ title: 'PM tool training gap', description: 'Ops resistance to new tool is a training issue, not a tool issue — schedule onboarding before forcing adoption', type: 'work' }],
    privacy_level: 'normal',
  },
  {
    transcript: 'Spanish tutor session was great today — covered subjunctive mood which I have been avoiding for weeks. Tutor suggested I start watching Spanish TV shows for immersion. Paid $45 for the session. My goal is to reach B2 level by June.',
    title: 'Spanish lesson — subjunctive mood',
    summary: 'Covered subjunctive, starting immersive TV shows. Goal: B2 by June.',
    note_type: 'thought',
    tasks: [
      { task: 'Start watching Spanish TV show for immersion practice', category: 'other', urgency: 'low', context: 'Learning' },
    ],
    expenses: [{ amount: '45', description: 'Spanish tutor session', category: 'education' }],
    ideas: [{ title: 'Language immersion via TV', description: 'Tutor recommends Spanish TV shows — more natural than textbook at B1+ level', type: 'personal' }],
    privacy_level: 'private',
  },
  {
    transcript: 'Morning run went well — 5k in 27 minutes, best time this month. Knee is feeling stronger since starting the physio exercises. Have a physio appointment next Tuesday at 10am, need to remind myself to ask about increasing training intensity before the 10k in March.',
    title: 'Morning run PR — knee progress',
    summary: '5k personal best. Physio appt Tuesday 10am. Ask about 10k training.',
    note_type: 'thought',
    tasks: [
      { task: 'Ask physio about increasing intensity for 10k training', category: 'other', urgency: 'medium', context: 'Health' },
    ],
    reminders: [{ text: 'Physio appointment Tuesday 10am', time: null, urgency: 'medium' }],
    privacy_level: 'normal',
  },
  {
    transcript: 'Team standup: Jake is almost done with the onboarding flow redesign — demo tomorrow at 2pm. Priya is blocked waiting for API credentials from the backend team, needs those today. Deployment to staging is scheduled for Friday. We are on track for the Q2 deadline.',
    title: 'Standup — onboarding demo tomorrow, Priya blocked',
    summary: 'Jake demos onboarding tomorrow 2pm. Priya needs API creds urgently. Deploy Friday.',
    note_type: 'meeting',
    tasks: [
      { task: 'Send API credentials to Priya — she is blocked', category: 'other', urgency: 'high', context: 'Engineering' },
      { task: 'Attend Jake onboarding flow demo at 2pm tomorrow', category: 'other', urgency: 'high', context: 'Engineering' },
    ],
    people: ['Jake', 'Priya'],
    follow_ups: [{ assignee: 'Priya', action: 'Confirm API credentials received and unblocked' }],
    decisions: ['Staging deploy on Friday', 'Q2 deadline on track'],
    privacy_level: 'local',
  },
  {
    transcript: 'Had an idea while running — what if there was a way to share your morning brief with your partner or spouse? Like a shared context layer. You could both see each other\'s key things for the day and prep better. Could be a premium feature called "Shared Brain". Might explore this.',
    title: 'Product idea: Shared Brain for couples',
    summary: 'Morning brief sharing between partners as premium feature.',
    note_type: 'idea',
    ideas: [{ title: 'Shared Brain — couples morning brief', description: 'Couples share daily brief with each other for shared context. Premium feature. Could work for teams too.', type: 'startup' }],
    privacy_level: 'private',
  },
  {
    transcript: 'Grocery run today. Spent $83 at Whole Foods. Remembered I need to call mom this weekend, she mentioned something about the house renovation being done. Also picked up birthday card for dad — his birthday is Saturday.',
    title: 'Grocery run + family reminders',
    summary: 'Groceries done. Call mom weekend. Dad\'s birthday Saturday.',
    note_type: 'thought',
    expenses: [{ amount: '83', description: 'Whole Foods grocery run', category: 'food' }],
    tasks: [
      { task: 'Call mom this weekend about house renovation', category: 'call', urgency: 'medium', context: 'Family' },
      { task: "Get gift for dad's birthday — Saturday", category: 'other', urgency: 'high', context: 'Family' },
    ],
    privacy_level: 'normal',
  },
];

export async function seedDemoDataIfNeeded(db: SQLiteDatabase): Promise<void> {
  const alreadySeeded = await getSetting(db, DEMO_SEED_KEY);
  if (alreadySeeded) return;

  const existingCount = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) as n FROM captures');
  if ((existingCount?.n ?? 0) > 0) {
    await setSetting(db, DEMO_SEED_KEY, 'true');
    return;
  }

  const now = new Date();

  for (let i = 0; i < DEMO_CAPTURES.length; i++) {
    const demo = DEMO_CAPTURES[i];
    const captureDate = new Date(now.getTime() - (i + 1) * 20 * 60 * 60 * 1000);
    const dateStr = captureDate.toISOString();

    await db.runAsync(
      `INSERT INTO captures (created_at, source, raw_transcript, privacy_level, processed, extracted_title, structured_text, processed_at)
       VALUES (?, 'text', ?, ?, 3, ?, ?, ?)`,
      dateStr, demo.transcript, demo.privacy_level, demo.title,
      `Title: ${demo.title}\nSummary: ${demo.summary}\nType: ${demo.note_type}`, dateStr,
    );

    const captureId = (await db.getFirstAsync<{ id: number }>('SELECT last_insert_rowid() as id'))?.id;
    if (!captureId) continue;

    for (const task of (demo as any).tasks ?? []) {
      await db.runAsync(
        'INSERT INTO todos (capture_id, task, category, urgency, context, privacy_level, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        captureId, task.task, task.category, task.urgency, task.context, demo.privacy_level, dateStr,
      );
    }
    for (const exp of (demo as any).expenses ?? []) {
      await db.runAsync(
        'INSERT INTO expenses (capture_id, amount, description, category, privacy_level, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        captureId, parseFloat(exp.amount), exp.description, exp.category, demo.privacy_level, dateStr,
      );
    }
    for (const idea of (demo as any).ideas ?? []) {
      await db.runAsync(
        'INSERT INTO ideas (capture_id, title, description, type, privacy_level, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        captureId, idea.title, idea.description, idea.type, demo.privacy_level, dateStr,
      );
    }
    for (const fu of (demo as any).follow_ups ?? []) {
      await db.runAsync(
        'INSERT INTO follow_ups (capture_id, assignee, action, privacy_level, created_at) VALUES (?, ?, ?, ?, ?)',
        captureId, fu.assignee, fu.action, demo.privacy_level, dateStr,
      );
    }
    await db.runAsync(
      'INSERT INTO mood_entries (capture_id, tone, energy, created_at) VALUES (?, ?, ?, ?)',
      captureId, i % 3 === 0 ? 'positive' : i % 3 === 1 ? 'calm' : 'focused', 'medium', dateStr,
    );
  }

  await setSetting(db, DEMO_SEED_KEY, 'true');
}
