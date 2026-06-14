import type { SQLiteDatabase } from 'expo-sqlite';
import { getSetting } from './settings';

const NON_PEOPLE = new Set([
  'date', 'time', 'today', 'tomorrow', 'yesterday', 'none', 'n/a', 'na', 'unknown', 'someone', 'self', 'me', 'i',
  // generic roles / collective nouns that are never a specific named person
  'manager', 'team', 'teams', 'friend', 'friends', 'colleague', 'colleagues', 'family', 'everyone',
  'people', 'staff', 'group', 'admin', 'hr', 'boss', 'client', 'customer', 'guest', 'member', 'members',
]);
const ORG_RE = /\b(solutions?|technolog(y|ies)|networks?|systems?|inc|ltd|llc|corp|corporation|company|pvt|limited|gmbh|university|college|institute|department|dept|bank|services?|labs?|studios?|industries|graduate|engineering|admin\s+team|team|group|nokia|snowflake|google|microsoft|amazon|meta|apple)\b/i;

/** Significant (≥4-char) tokens of a name, lowercased and punctuation-stripped. */
function nameTokens(s: string): string[] {
  return (s || '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((t) => t.length >= 4);
}

/** Is `name` a real person worth keeping in People — not the user themselves, an org, or junk. */
export function looksLikePerson(name: string, userName: string): boolean {
  const n = (name ?? '').trim();
  if (n.length < 2) return false;
  const low = n.toLowerCase();
  if (NON_PEOPLE.has(low)) return false;
  if (ORG_RE.test(n)) return false;                          // org names ("Nokia Solutions", "Networks")
  const u = (userName ?? '').trim().toLowerCase();
  if (u) {
    if (low === u || (u.length > 4 && (low.includes(u) || u.includes(low)))) return false; // exact/substring
    // Fuzzy self-match: OCR of the user's own ID/payslips produces name variants ("Venkata Krishna
    // Reddy Lekalla" vs "Vamsi Krishna Reddy Lekkala"). If a candidate shares 2+ significant name
    // tokens with the user, it's almost certainly the user, not a different person.
    const userTok = new Set(nameTokens(u));
    if (userTok.size >= 2) {
      const shared = nameTokens(low).filter((t) => userTok.has(t)).length;
      if (shared >= 2) return false;
    }
  }
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
