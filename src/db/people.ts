import type { SQLiteDatabase } from 'expo-sqlite';
import { getSetting } from './settings';

const NON_PEOPLE = new Set(['date', 'time', 'today', 'tomorrow', 'yesterday', 'none', 'n/a', 'na', 'unknown', 'someone', 'self', 'me', 'i']);
const ORG_RE = /\b(solutions?|technolog(y|ies)|networks?|systems?|inc|ltd|llc|corp|pvt|limited|gmbh|university|college|institute|department|bank|services?|labs?|studios?|industries)\b/i;

/** Is `name` a real person worth keeping in People — not the user themselves, an org, or junk. */
export function looksLikePerson(name: string, userName: string): boolean {
  const n = (name ?? '').trim();
  if (n.length < 2) return false;
  const low = n.toLowerCase();
  if (NON_PEOPLE.has(low)) return false;
  if (ORG_RE.test(n)) return false;                          // org names ("Nokia Solutions", "Networks")
  const u = (userName ?? '').trim().toLowerCase();
  if (u && (low === u || (u.length > 4 && (low.includes(u) || u.includes(low))))) return false; // the user themselves
  return true;
}

export async function upsertPerson(db: SQLiteDatabase, name: string, context: string): Promise<void> {
  await db.runAsync(
    `INSERT INTO people (name, last_mentioned, context) VALUES (?, CURRENT_TIMESTAMP, ?)
     ON CONFLICT(name) DO UPDATE SET last_mentioned = CURRENT_TIMESTAMP, context = excluded.context`,
    name,
    context,
  );
}

/** One-time / periodic self-heal: drop people that are actually the user, orgs, or junk. */
export async function cleanupJunkPeople(db: SQLiteDatabase): Promise<number> {
  const userName = (await getSetting(db, 'user_profile_name')) ?? '';
  const rows = await db.getAllAsync<{ id: number; name: string }>('SELECT id, name FROM people');
  let removed = 0;
  for (const r of rows) {
    if (!looksLikePerson(r.name, userName)) { await db.runAsync('DELETE FROM people WHERE id = ?', r.id); removed++; }
  }
  return removed;
}
