/**
 * Move / lease autopilot — FOUNDATION (Vamsi top-6 #5). PURE + deterministic + tested.
 *
 * A move is a real multi-step project (lease notice, deposit, movers, address changes, utilities,
 * internet) that otherwise lives only in the user's head. This module detects when a capture is about
 * a move/lease, pulls the key facts (kind, notice period, lease-end / move dates, the other party), and
 * can lay out a sensible relocation checklist with dates relative to the move — so a future autopilot
 * can spin up a project and chase the high-stakes "give notice by" deadline.
 *
 * NOT wired into extraction/DB/UI yet — that wiring (a move "project" with seeded tasks + dates, and the
 * proactive notice nudge) is a product/schema decision for the user; see project_pending_approval.
 * Reuses the scheduler's parseDeadline so dates resolve consistently with the rest of LUCY.
 */
import { parseDeadline } from '../scheduling/classify';

export type MoveLeaseKind = 'lease' | 'move';

export interface MoveLeaseDate {
  label: string;
  dueISO: string | null;
}

export interface MoveLeaseSignal {
  kind: MoveLeaseKind;
  trigger: string;             // the phrase that matched (for transparency)
  counterparty: string | null; // landlord / agent / movers name, when named
  noticeDays: number | null;   // parsed notice period, in days
  dates: MoveLeaseDate[];      // explicit dates found (lease end, move date, …)
}

// Lease-specific language (notice, deposit, landlord) takes priority — it carries the chase-worthy
// "give notice by" deadline. Move/relocation language is the broader signal.
const LEASE_RE = /\b(lease|tenancy|rental agreement|landlord|security deposit|renew(?:ing|al)?\s+(?:my|the)?\s*lease|month[- ]to[- ]month|move[- ]?out (?:date|notice)|notice (?:period|to vacate)|vacate)\b/i;
const MOVE_RE = /\b(moving (?:out|in|to|house|apartment|flat|home|abroad)|move[- ]?(?:out|in)\b|relocat(?:e|ing|ion)|shifting (?:to|house|homes?|apartments?)|new (?:apartment|place|flat|house|home)\b|change of address)\b/i;

const NAME_STOP = new Set(['I', 'We', 'The', 'A', 'An', 'My', 'Our', 'It', 'This', 'That', 'They', 'He', 'She', 'You', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);

/** Notice period in days, parsed from "60 days notice", "2 months notice", "notice period of 30 days". */
export function extractNoticePeriodDays(text: string): number | null {
  const t = text || '';
  const m =
    /\b(\d{1,3})\s*[- ]?\s*(day|days|month|months|week|weeks)['’]?\s*(?:notice|to vacate)\b/i.exec(t) ||
    /\bnotice\s+(?:period\s+)?(?:of\s+)?(\d{1,3})\s*(day|days|month|months|week|weeks)\b/i.exec(t);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = m[2].toLowerCase();
  if (unit.startsWith('month')) return n * 30;
  if (unit.startsWith('week')) return n * 7;
  return n;
}

/** A capitalized name following a role word ("landlord Dana", "agent Priya", "movers run by Sam"). */
function counterpartyNear(text: string): string | null {
  const m = /\b(?:landlord|agent|realtor|broker|mover|movers|property manager)\b[^.!?\n]{0,24}?\b([A-Z][a-zA-Z]+)\b/.exec(text || '');
  if (m && !NAME_STOP.has(m[1])) return m[1];
  return null;
}

function dateFor(re: RegExp, text: string, label: string, now: number): MoveLeaseDate | null {
  const m = re.exec(text);
  if (!m) return null;
  // Resolve the deadline from the matched clause (fall back to the whole sentence).
  const clause = m[0];
  const due = parseDeadline(clause, now) ?? parseDeadline(text, now);
  return due ? { label, dueISO: due } : null;
}

/** Detect whether a capture is about a move/lease and extract its key facts. Returns null when neither
 *  lease nor move language is present. */
export function detectMoveLease(text: string, now = Date.now()): MoveLeaseSignal | null {
  const t = (text || '').trim();
  if (!t) return null;
  const lease = LEASE_RE.exec(t);
  const move = MOVE_RE.exec(t);
  if (!lease && !move) return null;

  const kind: MoveLeaseKind = lease ? 'lease' : 'move';
  const trigger = (lease?.[0] ?? move?.[0] ?? '').trim();

  const dates: MoveLeaseDate[] = [];
  const leaseEnd = dateFor(/\blease\s+(?:ends?|expires?|is up|ending|finishes?|runs out)\b[^.!?\n]*/i, t, 'Lease ends', now);
  if (leaseEnd) dates.push(leaseEnd);
  const moveDate = dateFor(/\b(?:mov(?:e|ing)|shift(?:ing)?|relocat(?:e|ing))\b[^.!?\n]*?\b(?:on|by|before)\b[^.!?\n]*/i, t, 'Move date', now);
  if (moveDate) dates.push(moveDate);
  // If nothing specific matched, still surface a single primary date if the text has one.
  if (dates.length === 0) {
    const primary = parseDeadline(t, now);
    if (primary) dates.push({ label: kind === 'lease' ? 'Lease date' : 'Move date', dueISO: primary });
  }

  return {
    kind,
    trigger,
    counterparty: counterpartyNear(t),
    noticeDays: extractNoticePeriodDays(t),
    dates,
  };
}

/** When the user must GIVE notice: lease-end minus the notice period (default 30 days). Returns ISO or
 *  null. This is the highest-stakes, most-forgotten move deadline. */
export function noticeDeadline(leaseEndISO: string, noticeDays = 30): string | null {
  const end = Date.parse(leaseEndISO);
  if (!Number.isFinite(end)) return null;
  const days = Number.isFinite(noticeDays) && noticeDays > 0 ? noticeDays : 30;
  return new Date(end - days * 24 * 60 * 60 * 1000).toISOString();
}

export interface RelocationStep {
  task: string;
  /** Days relative to the move date (negative = before the move, positive = after). */
  offsetDays: number;
}

/** A sensible, ordered default checklist for a move, timed relative to the move date. The autopilot can
 *  seed these as tasks with real dates (see relocationPlan) and let the user adjust. */
export const RELOCATION_CHECKLIST: RelocationStep[] = [
  { task: 'Give your landlord written notice', offsetDays: -60 },
  { task: 'Get quotes and book movers', offsetDays: -30 },
  { task: 'Declutter and sort what to keep, donate, toss', offsetDays: -21 },
  { task: 'Order packing supplies (boxes, tape, labels)', offsetDays: -21 },
  { task: 'Set up utilities at the new place (power, gas, water)', offsetDays: -14 },
  { task: 'Transfer or set up internet', offsetDays: -14 },
  { task: 'Change your address (bank, employer, subscriptions)', offsetDays: -10 },
  { task: 'Forward your mail', offsetDays: -7 },
  { task: 'Confirm movers, elevator and parking', offsetDays: -3 },
  { task: 'Pack an essentials box (first night)', offsetDays: -2 },
  { task: 'Take meter readings and move-out condition photos', offsetDays: 0 },
  { task: 'Return keys and request your deposit back', offsetDays: 1 },
  { task: "Update driver's license and registration", offsetDays: 14 },
];

/** Lay the checklist onto a real timeline given the move date. Steps that would fall in the past (e.g.
 *  the move is in 2 weeks but "book movers" is -30d) are clamped to today so nothing is silently lost. */
export function relocationPlan(moveDateISO: string, now = Date.now()): Array<{ task: string; dueISO: string }> {
  const base = Date.parse(moveDateISO);
  if (!Number.isFinite(base)) return [];
  return RELOCATION_CHECKLIST.map((s) => {
    const raw = base + s.offsetDays * 24 * 60 * 60 * 1000;
    return { task: s.task, dueISO: new Date(Math.max(raw, now)).toISOString() };
  });
}
