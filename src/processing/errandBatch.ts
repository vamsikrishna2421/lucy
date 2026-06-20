/**
 * Errand batching (Vamsi unmet need) — PURE. Groups piled-up errands so LUCY can nudge "next time
 * you're out, knock these out together" and "batch these calls in one sitting". No geo (location
 * grouping is a future nicety); split by out-and-about errands vs calls/messages. Pure → unit-testable.
 */
export interface ErrandLike { task: string; category?: string | null }

const ERRAND_VERB = /\b(pick up|pickup|pick-up|drop off|drop-?off|buy|grab|get|return|exchange|mail|post|ship|deposit|collect|refill|renew|stop by)\b/i;
const CALL_VERB = /\b(call|phone|ring|text|message|email|book|schedule|reschedule|cancel|reply)\b/i;

function isOutErrand(t: ErrandLike): boolean {
  return (t.category || '').toLowerCase() === 'errand' || ERRAND_VERB.test(t.task || '');
}
function isCallErrand(t: ErrandLike): boolean {
  if (isOutErrand(t)) return false; // an out-errand wins (don't double-count "pick up + call")
  return (t.category || '').toLowerCase() === 'call' || CALL_VERB.test(t.task || '');
}

export interface ErrandGroups { out: string[]; calls: string[] }

export function groupErrands(todos: ErrandLike[]): ErrandGroups {
  const out: string[] = []; const calls: string[] = [];
  for (const t of todos) {
    const task = (t.task || '').trim();
    if (!task) continue;
    if (isOutErrand(t)) out.push(task);
    else if (isCallErrand(t)) calls.push(task);
  }
  return { out, calls };
}

/** A warm nudge when errands have piled up enough to be worth batching (≥ threshold each). Null when
 *  there's nothing worth proposing. Propose-only — never changes anything. */
export function errandBatchNudge(todos: ErrandLike[], threshold = 3): string | null {
  const { out, calls } = groupErrands(todos);
  const parts: string[] = [];
  if (out.length >= threshold) parts.push(`${out.length} errands are piling up — next time you're out, knock them out together: ${out.slice(0, 5).join(', ')}.`);
  if (calls.length >= threshold) parts.push(`${calls.length} calls/messages are waiting — batch them in one sitting: ${calls.slice(0, 5).join(', ')}.`);
  return parts.length ? parts.join(' ') : null;
}
