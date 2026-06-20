/**
 * Follow-up dedup — PURE. A single capture (esp. a run-on like "send the deck to X and X owes me Y")
 * can make the LLM emit several near-identical follow_ups ("Priya: send the invoice" / "send Vamsi the
 * invoice" / "send invoice"). This collapses those so the Focus Now "Follow-ups" list isn't noisy.
 * Used by persistExtraction before inserting; kept pure so it's unit-testable.
 */
export interface FollowUpLike { assignee: string; action: string }

function norm(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Two follow-ups are "the same" when they target the same person (or one is unnamed) AND the actions
 *  match closely (equal, substring, or ≥60% meaningful-word overlap). */
export function isSimilarFollowUp(a: FollowUpLike, b: FollowUpLike): boolean {
  const aa = norm(a.assignee); const ba = norm(b.assignee);
  // Different named people → not the same follow-up. (Empty assignee is treated as a wildcard.)
  if (aa && ba && aa !== ba && !aa.includes(ba) && !ba.includes(aa)) return false;

  const ax = norm(a.action); const bx = norm(b.action);
  if (!ax || !bx) return false;
  if (ax === bx || ax.includes(bx) || bx.includes(ax)) return true;

  const wa = new Set(ax.split(' ').filter((w) => w.length > 3));
  const wb = new Set(bx.split(' ').filter((w) => w.length > 3));
  if (wa.size === 0 || wb.size === 0) return false;
  const overlap = [...wa].filter((w) => wb.has(w)).length;
  return overlap / Math.max(wa.size, wb.size) >= 0.6;
}

/** Collapse a list of follow-ups, keeping the first of each similar group. */
export function dedupeFollowUps<T extends FollowUpLike>(items: T[]): T[] {
  const kept: T[] = [];
  for (const it of items) {
    if (!kept.some((k) => isSimilarFollowUp(k, it))) kept.push(it);
  }
  return kept;
}
