/**
 * Demo data seeding — shown to first-time users after onboarding.
 *
 * Seeds 3 captures that demonstrate LUCY's core value:
 *   1. A work capture → TASK + PERSON + EXPENSE extracted
 *   2. A personal capture → IDEA + MOOD
 *   3. A journal entry → splits into events
 *
 * Seeds are marked with a special tag so they can be cleared with "Delete all."
 * Uses the same enqueueTranscript pipeline so they get processed by real AI.
 */

import type { SQLiteDatabase } from 'expo-sqlite';
import { getSetting, setSetting } from '../db/settings';
import { enqueueTranscript } from './extract';

const DEMO_SEEDED_KEY = 'demo_data_seeded_v1';

const DEMO_CAPTURES = [
  // 1. Classic multi-entity capture — shows LUCY's extraction power
  `Had a great call with Marcus today about the Q3 pitch deck. He wants the revenue slide revised by Thursday. Also need to pick up coffee and snacks for the team meeting, around $40 total.`,

  // 2. Personal idea + mood — shows LUCY understanding feelings + ideas
  `Feeling really excited today — had this idea for a side project: a private app that helps people track meaningful moments from their daily life, like a second brain. Could be really useful. Also need to call mom this weekend.`,

  // 3. Short journal that splits — shows the journal-to-timeline feature
  `Today was busy. Morning standup ran long, decided to push the v2 launch to next quarter. Afternoon walked to the pharmacy — spent 850 rupees on prescriptions. Evening walk, felt good finally.`,
];

export async function seedDemoDataIfNeeded(db: SQLiteDatabase): Promise<boolean> {
  if (await getSetting(db, DEMO_SEEDED_KEY) === 'true') return false;

  for (const text of DEMO_CAPTURES) {
    await enqueueTranscript(text, 'text', false);
  }

  await setSetting(db, DEMO_SEEDED_KEY, 'true');
  return true;
}
