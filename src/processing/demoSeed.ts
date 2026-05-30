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

export async function seedDemoDataIfNeeded(db: SQLiteDatabase, onProgress?: (pct: number) => void): Promise<void> {
  const alreadySeeded = await getSetting(db, DEMO_SEED_KEY);
  if (alreadySeeded) return;

  const existingCount = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) as n FROM captures');
  if ((existingCount?.n ?? 0) > 0) {
    await setSetting(db, DEMO_SEED_KEY, 'true');
    return;
  }

  onProgress?.(5);

  // Load pre-parsed entries via dynamic import
  const entriesModule = await import('./eleanor_seed_data.json');
  const entries: RawEntry[] = (entriesModule.default ?? entriesModule) as unknown as RawEntry[];

  // Build all SQL as a single execAsync batch — one bridge call instead of 4000+
  const captureRows: string[] = [];
  const moodRows: string[] = [];
  const todoRows: string[] = [];

  const esc = (s: string) => s.replace(/'/g, "''");

  // Profile capture (id = 1)
  captureRows.push(
    `('${PROFILE_CAPTURE.d}','text','${esc(PROFILE_CAPTURE.transcript)}','normal',3,'${esc(PROFILE_CAPTURE.title)}','Title: ${esc(PROFILE_CAPTURE.title)}','${PROFILE_CAPTURE.d}')`,
  );

  // Daily entries (ids 2..1462)
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const id = i + 2; // 1-based, profile took id 1
    const title = `Eleanor — ${entry.d.slice(0, 10)}`;
    const structured = `Title: ${esc(title)}\nPeople: ${entry.p.join(', ')}`;

    captureRows.push(
      `('${entry.d}','text','${esc(entry.tr)}','normal',3,'${esc(title)}','${esc(structured)}','${entry.d}')`,
    );

    const energy = entry.m === 'negative' ? 'low' : 'medium';
    moodRows.push(`(${id},'${entry.m}','${energy}','${entry.d}')`);

    for (const task of entry.pt) {
      todoRows.push(`(${id},'${esc(task)}','other','medium','Eleanor','normal','${entry.d}')`);
    }
  }
  // Profile mood
  moodRows.unshift(`(1,'positive','high','${PROFILE_CAPTURE.d}')`);

  const CHUNK = 400; // Insert in chunks to avoid SQLite statement length limits
  const insertChunks = async (table: string, cols: string, rows: string[]) => {
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK).join(',');
      await db.execAsync(`INSERT INTO ${table} (${cols}) VALUES ${chunk};`);
    }
  };

  onProgress?.(20);
  await insertChunks(
    'captures',
    'created_at,source,raw_transcript,privacy_level,processed,extracted_title,structured_text,processed_at',
    captureRows,
  );
  onProgress?.(70);
  await insertChunks('mood_entries', 'capture_id,tone,energy,created_at', moodRows);
  onProgress?.(85);
  if (todoRows.length > 0) {
    await insertChunks('todos', 'capture_id,task,category,urgency,context,privacy_level,created_at', todoRows);
  }
  onProgress?.(95);

  await setSetting(db, DEMO_SEED_KEY, 'true');
}
