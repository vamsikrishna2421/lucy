/**
 * Project autopilot — proposes Workspace projects from clusters LUCY already sees in the brain.
 *
 * The knowledge graph already extracts 'project'/'organization'/'product' entities with an evidence
 * count (how many captures mention them). When one recurs across several captures but has no project
 * space yet, we suggest creating it ("I see 5 notes about Genie — make a project?"). Propose-and-confirm
 * only — never auto-create (per the note-merge lesson that silent mutation makes a mess). Because
 * projects link to items by name match (projectActivity), creating the project immediately gathers the
 * related tasks/blocks without moving anything.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import { addProjectAlias, listProjects, projectAliases } from '../db/projects';

export interface ProjectSuggestion { name: string; evidence: number; entityType: string }

const norm = (s: string): string => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
// Generic words that aren't real projects even if they recur.
const GENERIC = new Set(['work', 'life', 'project', 'product', 'stuff', 'misc', 'general', 'personal', 'app', 'idea', 'team', 'company', 'meeting', 'task', 'today', 'tomorrow', 'ai', 'application', 'apps']);

/** Meaningful (non-generic) tokens of a name, for near-duplicate comparison. */
function meaningfulTokens(s: string): Set<string> {
  return new Set(norm(s).split(' ').filter((t) => t.length >= 2 && !GENERIC.has(t)));
}

/** True when `candidate` is essentially the same project as one that already exists — e.g. "Lucy app"
 *  vs an existing "Lucy". Catches subset/superset and heavy token overlap so we don't suggest a near-
 *  duplicate of a project (or alias) the user already has. Exported for unit tests. */
export function isNearExisting(candidate: string, existingNames: string[]): boolean {
  const cand = meaningfulTokens(candidate);
  if (cand.size === 0) return false;
  for (const name of existingNames) {
    const ex = meaningfulTokens(name);
    if (ex.size === 0) continue;
    const overlap = [...cand].filter((t) => ex.has(t)).length;
    const subset = overlap === ex.size || overlap === cand.size; // one fully contains the other
    const jaccard = overlap / (cand.size + ex.size - overlap);
    if (subset || jaccard >= 0.5) return true;
  }
  return false;
}

export async function deriveProjectSuggestions(db: SQLiteDatabase, minEvidence = 3, max = 5): Promise<ProjectSuggestion[]> {
  let rows: Array<{ name: string; entity_type: string; evidence_count: number }> = [];
  try {
    rows = await db.getAllAsync<{ name: string; entity_type: string; evidence_count: number }>(
      `SELECT name, entity_type, evidence_count FROM knowledge_entities
       WHERE entity_type IN ('project','organization','product','initiative')
         AND evidence_count >= ?
       ORDER BY evidence_count DESC LIMIT 40`,
      minEvidence,
    );
  } catch { return []; }

  // Existing projects + every alias they've absorbed — used for both exact and near-duplicate skipping.
  const projects = await listProjects(db);
  const existingNames: string[] = [];
  for (const p of projects) { existingNames.push(p.name, ...projectAliases(p)); }
  const existing = new Set(existingNames.map(norm));
  // Also skip ones the user already dismissed (stored as a setting list).
  let dismissed = new Set<string>();
  try {
    const { getSetting } = await import('../db/settings');
    const raw = await getSetting(db, 'project_autopilot_dismissed');
    if (raw) dismissed = new Set(JSON.parse(raw) as string[]);
  } catch { /* ignore */ }

  const seen = new Set<string>();
  const out: ProjectSuggestion[] = [];
  for (const r of rows) {
    const key = norm(r.name);
    if (!key || key.length < 3 || GENERIC.has(key) || existing.has(key) || dismissed.has(key) || seen.has(key)) continue;
    // Don't propose a near-duplicate of a project the user already has (e.g. "Lucy app" when "Lucy" exists).
    if (isNearExisting(r.name, existingNames)) continue;
    seen.add(key);
    out.push({ name: r.name.trim(), evidence: r.evidence_count, entityType: r.entity_type });
    if (out.length >= max) break;
  }
  return out;
}

/** Merge a suggested cluster into an existing project: record the suggestion's name as an alias of that
 *  project (so it absorbs the cluster's items) and dismiss the suggestion. Non-destructive + reversible. */
export async function mergeSuggestionIntoProject(db: SQLiteDatabase, projectId: number, suggestionName: string): Promise<void> {
  await addProjectAlias(db, projectId, suggestionName);
  await dismissProjectSuggestion(db, suggestionName);
}

/** Tidy a long, run-on project name into a short headline + the rest as a description, by splitting on
 *  the first strong separator (— – : | · or a spaced hyphen). Pure — used to PREFILL the rename form so
 *  the user can one-tap "Interactive Food Bowl Builder App — Tap-to-Assemble Salad…" into a clean name +
 *  description. Returns the name unchanged (empty description) when there's no separator. */
export function splitHeadline(name: string): { headline: string; description: string } {
  const s = (name || '').trim();
  const m = /\s*[—–:|·]\s*|\s+-\s+/.exec(s);
  if (m && m.index > 0) {
    const headline = s.slice(0, m.index).trim();
    const description = s.slice(m.index + m[0].length).trim();
    if (headline) return { headline, description };
  }
  return { headline: s, description: '' };
}

/** Remember a dismissed suggestion so we don't keep proposing it. */
export async function dismissProjectSuggestion(db: SQLiteDatabase, name: string): Promise<void> {
  try {
    const { getSetting, setSetting } = await import('../db/settings');
    const raw = await getSetting(db, 'project_autopilot_dismissed');
    const list: string[] = raw ? JSON.parse(raw) : [];
    const key = norm(name);
    if (!list.includes(key)) list.push(key);
    await setSetting(db, 'project_autopilot_dismissed', JSON.stringify(list));
  } catch { /* ignore */ }
}
