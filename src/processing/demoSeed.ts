/**
 * Demo Brain seeder.
 *
 * Seeds Eleanor Vance's 4 years of daily records (Dec 2020 – Nov 2024) into
 * the Demo Brain DB. All 1460 entries are inserted in a single transaction —
 * takes ~5-10 seconds on device, happens once only.
 *
 * Eleanor Vance: Marketing Director, married (David), two kids (Owen, Clara),
 * runs, studies Spanish, chases a 10k PR.
 */

import type { SQLiteDatabase } from 'expo-sqlite';
import { getSetting, setSetting } from '../db/settings';

const DEMO_SEED_KEY = 'demo_data_seeded';

interface RawEntry {
  d: string;  // ISO date
  tr: string; // transcript
  p: string[];  // people
  pt: string[]; // pending tasks
  m: 'positive' | 'negative' | 'calm'; // mood
}

// Eleanor's profile intro capture — shown at top of timeline
const PROFILE_CAPTURE = {
  d: '2020-11-30T09:00:00.000Z',
  title: "Eleanor's Brain — 4 years of memory",
  transcript: "Eleanor Vance. Marketing Director at Lumina Marketing. Married to David. Owen is 8, Clara is 5. Running, yoga, learning Spanish. Working toward B2 Spanish and a 10k PR. Goals: better work-life balance, more mindfulness. This is 4 years of her life, captured day by day.",
  m: 'positive',
};

export async function seedDemoDataIfNeeded(db: SQLiteDatabase): Promise<void> {
  const alreadySeeded = await getSetting(db, DEMO_SEED_KEY);
  if (alreadySeeded) return;

  const existingCount = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) as n FROM captures');
  if ((existingCount?.n ?? 0) > 0) {
    await setSetting(db, DEMO_SEED_KEY, 'true');
    return;
  }

  // Load pre-parsed entries (dynamic import keeps the 750KB off the startup critical path)
  const entriesModule = await import('./eleanor_seed_data.json');
  const entries: RawEntry[] = (entriesModule.default ?? entriesModule) as unknown as RawEntry[];

  await db.withTransactionAsync(async () => {
    // Insert Eleanor's profile capture first
    await db.runAsync(
      `INSERT INTO captures (created_at, source, raw_transcript, privacy_level, processed, extracted_title, structured_text, processed_at)
       VALUES (?, 'text', ?, 'normal', 3, ?, ?, ?)`,
      PROFILE_CAPTURE.d, PROFILE_CAPTURE.transcript, PROFILE_CAPTURE.title,
      `Title: ${PROFILE_CAPTURE.title}`, PROFILE_CAPTURE.d,
    );
    const profileId = (await db.getFirstAsync<{ id: number }>('SELECT last_insert_rowid() as id'))?.id;
    if (profileId) {
      await db.runAsync(
        'INSERT INTO mood_entries (capture_id, tone, energy, created_at) VALUES (?, ?, ?, ?)',
        profileId, 'positive', 'high', PROFILE_CAPTURE.d,
      );
    }

    // Insert all daily log entries
    for (const entry of entries) {
      const title = `Eleanor — ${entry.d.slice(0, 10)}`;
      await db.runAsync(
        `INSERT INTO captures (created_at, source, raw_transcript, privacy_level, processed, extracted_title, structured_text, processed_at)
         VALUES (?, 'text', ?, 'normal', 3, ?, ?, ?)`,
        entry.d, entry.tr, title,
        `Title: ${title}\nPeople: ${entry.p.join(', ')}`, entry.d,
      );

      const captureId = (await db.getFirstAsync<{ id: number }>('SELECT last_insert_rowid() as id'))?.id;
      if (!captureId) continue;

      // Insert pending tasks
      for (const task of entry.pt) {
        await db.runAsync(
          'INSERT INTO todos (capture_id, task, category, urgency, context, privacy_level, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          captureId, task, 'other', 'medium', 'Eleanor', 'normal', entry.d,
        );
      }

      // Insert people mentions
      for (const person of entry.p) {
        await db.runAsync(
          `INSERT OR IGNORE INTO people (name, last_mentioned) VALUES (?, ?)`,
          person, entry.d,
        ).catch(() => {});
        await db.runAsync(
          `UPDATE people SET last_mentioned = ?, mention_count = mention_count + 1 WHERE name = ?`,
          entry.d, person,
        ).catch(() => {});
      }

      // Insert mood
      await db.runAsync(
        'INSERT INTO mood_entries (capture_id, tone, energy, created_at) VALUES (?, ?, ?, ?)',
        captureId, entry.m, entry.m === 'negative' ? 'low' : 'medium', entry.d,
      );
    }
  });

  await setSetting(db, DEMO_SEED_KEY, 'true');
}
