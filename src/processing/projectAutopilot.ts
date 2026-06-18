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
import { listProjects } from '../db/projects';

export interface ProjectSuggestion { name: string; evidence: number; entityType: string }

const norm = (s: string): string => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
// Generic words that aren't real projects even if they recur.
const GENERIC = new Set(['work', 'life', 'project', 'product', 'stuff', 'misc', 'general', 'personal', 'app', 'idea', 'team', 'company', 'meeting', 'task', 'today', 'tomorrow']);

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

  const existing = new Set((await listProjects(db)).map((p) => norm(p.name)));
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
    seen.add(key);
    out.push({ name: r.name.trim(), evidence: r.evidence_count, entityType: r.entity_type });
    if (out.length >= max) break;
  }
  return out;
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
