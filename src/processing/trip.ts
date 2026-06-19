/**
 * Trip co-pilot (Vamsi unmet need: "Trip co-pilot") — PURE detection + checklist + date math.
 *
 * Detects when a capture is about travel ("flying to Chicago Aug 12", "trip to Goa next Friday",
 * "booked the hotel for the Boston trip"), pulls the destination + departure/return dates, and can lay
 * out a sensible pre-trip checklist timed to departure — so a future planner can spin up a "Trip to X"
 * project and chase check-in / leave-for-airport. NOT wired here (tripPlanner.ts persists; ProjectsTab
 * surfaces). Reuses the scheduler's (now richer) parseDeadline so "next Friday" / "Aug 12" resolve.
 */
import { parseDeadline } from '../scheduling/classify';

export interface TripDate { label: string; dueISO: string | null }
export interface TripSignal {
  destination: string | null;
  trigger: string;        // the phrase that matched (transparency)
  dates: TripDate[];      // Departure / Return when found
}

// Travel-specific language only — deliberately NOT "going to" / bare "to" (too broad → false trips).
const TRIP_RE = /\b(flight|flying|fly to|trip to|travel(?:ing|ling)? to|vacation|holiday (?:in|to)|layover|boarding pass|red[- ]?eye|itinerary|book(?:ed|ing)?\s+(?:a |my |the )?(?:flight|hotel|airbnb)|checking in for (?:my|the) flight|visiting\s+[A-Za-z])\b/i;

const STOP = new Set([
  'I', 'We', 'The', 'A', 'An', 'My', 'Our', 'It', 'This', 'That', 'They', 'He', 'She', 'You', 'Next', 'On',
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
]);

/** The place being travelled to, when named (1–2 capitalized words after a travel lead-in). The lead-in
 *  matches case-insensitively (it may start a sentence), but the destination itself must be Capitalized. */
function extractDestination(text: string): string | null {
  const m = /\b(?:trip to|flying to|fly to|flying into|travel(?:ing|ling)? to|vacation in|holiday in|visiting|heading to)\s+([A-Za-z]+)(?:\s+([A-Za-z]+))?/i.exec(text);
  if (!m) return null;
  const w1 = m[1]; const w2 = m[2];
  if (!/^[A-Z]/.test(w1) || STOP.has(w1)) return null;
  if (w2 && /^[A-Z]/.test(w2) && !STOP.has(w2)) return `${w1} ${w2}`;
  return w1;
}

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Detect whether a capture is about a trip, with destination + departure/return dates. Null when it's
 *  not travel. */
export function detectTrip(text: string, now = Date.now()): TripSignal | null {
  const t = (text || '').trim();
  if (!t) return null;
  const hit = TRIP_RE.exec(t);
  if (!hit) return null;

  const dates: TripDate[] = [];
  // Return first (so a "back/return … <date>" clause isn't mistaken for the departure).
  const retClause = /\b(?:back|return(?:ing)?|fly(?:ing)? back|until|till|through)\b[^.!?\n]*/i.exec(t);
  const retISO = retClause ? parseDeadline(retClause[0], now) : null;
  // Departure: prefer a "from/leaving/departing/flying … <date>" clause, else the whole text.
  const depClause = /\b(?:from|leaving|departing|depart|flying out|fly out|leave on)\b[^.!?\n]*/i.exec(t);
  const depISO = (depClause ? parseDeadline(depClause[0], now) : null) ?? parseDeadline(t, now);
  if (depISO && depISO !== retISO) dates.push({ label: 'Departure', dueISO: depISO });
  if (retISO) dates.push({ label: 'Return', dueISO: retISO });

  return { destination: extractDestination(t), trigger: clean(hit[0]), dates };
}

export interface TripStep {
  task: string;
  /** Days relative to departure (negative = before). */
  offsetDays: number;
}

/** A sensible default pre-trip checklist, timed relative to the departure date. */
export const TRIP_CHECKLIST: TripStep[] = [
  { task: 'Book flights', offsetDays: -30 },
  { task: 'Book accommodation', offsetDays: -30 },
  { task: 'Check your passport / visa is valid', offsetDays: -30 },
  { task: 'Sort travel insurance', offsetDays: -21 },
  { task: 'Plan what to see and who to meet', offsetDays: -14 },
  { task: 'Tell your bank you are travelling', offsetDays: -5 },
  { task: 'Arrange airport transport', offsetDays: -3 },
  { task: 'Download tickets, boarding pass and offline maps', offsetDays: -2 },
  { task: 'Pack', offsetDays: -1 },
  { task: 'Check in online', offsetDays: -1 },
  { task: 'Leave for the airport', offsetDays: 0 },
];

/** Lay the checklist onto a real timeline given departure; past-dated steps clamp to now so nothing is
 *  silently lost. */
export function tripPlan(departISO: string, now = Date.now()): Array<{ task: string; dueISO: string }> {
  const base = Date.parse(departISO);
  if (!Number.isFinite(base)) return [];
  return TRIP_CHECKLIST.map((s) => {
    const raw = base + s.offsetDays * 24 * 60 * 60 * 1000;
    return { task: s.task, dueISO: new Date(Math.max(raw, now)).toISOString() };
  });
}
