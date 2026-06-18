export function recognizesTodayPlanQuestion(question: string): boolean {
  return /\b(today|for today|this day)\b/i.test(question)
    && /\b(task|tasks|todo|to do|pending|deadline|deadlines|due)\b/i.test(question);
}

export function recognizesMemoryMapQuestion(question: string): boolean {
  return /\b(what|who|show|tell|which|how)\b/i.test(question)
    && /\b(know|known|remember|memory|happening|connected|connection|involve|involved|related|repeat|repeating|project|work)\b/i.test(question);
}

export function recognizesMonthlySpendingQuestion(question: string): boolean {
  return /\b(summary|summarize|total|how much|show|what)\b/i.test(question)
    && /\b(payment|payments|paid|expense|expenses|spend|spent|spending|cost|costs)\b/i.test(question);
}

/**
 * Whether a spending question is scoped to all-time / total rather than the current month.
 * "this month"/"monthly" → month scope; "total"/"all"/"so far"/"overall"/"ever"/"in total" → all-time.
 * Defaults to all-time when no month phrase is present (so "how much have I spent?" sums everything).
 */
export function spendingScopeIsAllTime(question: string): boolean {
  return spendingWindow(question).kind === 'all';
}

/**
 * Resolve the time window a spending question asks about, so "how much did I spend LAST WEEK" isn't
 * silently answered with the all-time total. Returns a kind + a human label used verbatim in the
 * answer so the scope is always honest. Defaults to all-time only when no period phrase is present.
 */
export type SpendingWindowKind = 'today' | 'week' | 'month' | 'lastMonth' | 'year' | 'all';
export interface SpendingWindow { kind: SpendingWindowKind; label: string }

export function spendingWindow(question: string): SpendingWindow {
  const q = question.toLowerCase();
  if (/\blast month\b/.test(q)) return { kind: 'lastMonth', label: 'last month' };
  if (/\b(this month|this\s+month'?s|past month|monthly)\b/.test(q)) return { kind: 'month', label: 'this month' };
  if (/\b(today|so far today)\b/.test(q)) return { kind: 'today', label: 'today' };
  if (/\b(this week|last week|past week|weekly|last 7 days|past 7 days)\b/.test(q)) return { kind: 'week', label: 'the last 7 days' };
  if (/\b(this year|year to date|ytd|annually|this\s+year'?s)\b/.test(q)) return { kind: 'year', label: 'this year' };
  if (/\b(total|all[- ]?time|overall|ever|so far|altogether|in all)\b/.test(q)) return { kind: 'all', label: 'in total' };
  return { kind: 'all', label: 'in total' };
}

export function recognizesSchedulingQuestion(question: string): boolean {
  // NOTE: "plan my day" is intentionally NOT here — that's an agenda request, best answered by the LLM
  // (a prioritized plan from real tasks/captures), not the single-task slot finder.
  return /\b(when (should|can|do|could) i|find (me )?(a )?time|best time|good time|what time should|schedule (a|an|some|this|that|my|the)|fit (it|this|that|.+) (in|into)|book (time|a slot|me)|squeeze in|make time for|free time for|time to)\b/i.test(question);
}

/**
 * Long, multi-topic, or emotional/help-seeking messages must go to the LLM (LUCY's strongest mode) and
 * NOT be hijacked by a keyword fast-path (e.g. a stressed rant containing "today" being answered with
 * "22 pending tasks"). Keep the structured detectors for short, clearly-structured queries only.
 */
export function isComplexOrEmotionalQuery(question: string): boolean {
  const q = question.trim();
  if (q.split(/\s+/).length >= 28) return true; // long rant / brain-dump
  return /\b(stress(ed|ing)?|overwhelm\w*|anxious|anxiety|exhaust\w*|burn(t|ed)?\s?out|don'?t know where|where (do|to) (i )?(even )?start|so much going on|a lot going on|too much (going|to)|honestly|i feel|i'?m feeling|feeling (low|down|off|tired|lost|stuck)|falling behind|can'?t keep up|drowning|all over the place|losing track|where do i begin)\b/i.test(q);
}

const WEEKDAYS_RE = '(?:sun|mon|tues?|wednes?|thurs?|fri|satur)day';

/**
 * Pull an EXPLICIT clock time out of a scheduling request ("schedule gym at 6:30am tomorrow") so it
 * can be committed directly instead of merely suggested. Returns the day phrase + "HH:MM" (24h) for
 * computeStart, or null when no concrete time is present ("find me time for X" → suggest, don't commit).
 * Deterministic + pure (testable). Conservative: requires am/pm, a colon, or noon/midnight so a bare
 * number ("call 3 people") is never mistaken for a time.
 */
export function parseExplicitDateTime(question: string): { day: string | null; time: string } | null {
  const q = question.toLowerCase();
  let hh: number | null = null;
  let mm = 0;
  let m: RegExpMatchArray | null;
  if (/\bnoon\b|\bmidday\b/.test(q)) { hh = 12; mm = 0; }
  else if (/\bmidnight\b/.test(q)) { hh = 0; mm = 0; }
  else if ((m = q.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/))) {
    hh = Number(m[1]) % 12; mm = m[2] ? Number(m[2]) : 0;
    if (m[3] === 'pm') hh += 12;
  } else if ((m = q.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/))) {
    hh = Number(m[1]); mm = Number(m[2]);
  }
  if (hh === null || hh > 23 || mm > 59) return null;

  let day: string | null = null;
  let dm: RegExpMatchArray | null;
  if (/\btomorrow\b/.test(q)) day = 'tomorrow';
  else if (/\btonight\b|\btoday\b/.test(q)) day = 'today';
  else if ((dm = q.match(/\b(\d{4}-\d{2}-\d{2})\b/))) day = dm[1];
  else if ((dm = q.match(new RegExp(`\\b(?:next\\s+)?(${WEEKDAYS_RE})\\b`)))) day = dm[1];

  return { day, time: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}` };
}

/** Strips the scheduling phrasing to recover the underlying task ("find time to call mom" → "call mom"). */
export function extractSchedulableTask(question: string): string {
  let t = question.trim();
  t = t.replace(/^\s*(hey )?lucy[,\s]+/i, '');
  t = t.replace(/\b(when (should|can|do|could) i|what time should i|find (me )?(a )?time (to|for)?|best time (to|for)?|good time (to|for)?|schedule|book (time )?(to|for)?|make time (to|for)?|squeeze in|fit (in )?|free time for|i need to|i want to|i have to|time to)\b/gi, ' ');
  t = t.replace(/\b(today|tonight|tomorrow|this week|next week|please|sometime|some time)\b/gi, ' ');
  // Strip an explicit time + weekday so the committed/suggested title is clean ("gym", not "gym at 6:30am monday").
  t = t.replace(/\b(?:at\s+)?(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)|(?:[01]?\d|2[0-3]):[0-5]\d|noon|midday|midnight)\b/gi, ' ');
  t = t.replace(new RegExp(`\\b(?:on\\s+|next\\s+)?(?:${WEEKDAYS_RE})\\b`, 'gi'), ' ');
  t = t.replace(/\b(\d{4}-\d{2}-\d{2})\b/g, ' ');
  t = t.replace(/[?.!]+$/g, '').replace(/\s+/g, ' ').trim();
  return t || question.trim();
}

export function normalizeMemoryLookupText(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/\boffice\b/g, 'ofc')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function requestedTaskContext(question: string): string | null {
  const match = question.match(
    /\brelated\s+to\s+(.+?)(?:\s+(?:do|should|can|could|will)\s+i\b|\s+(?:for\s+)?today\b|\s+(?:tasks?|todos?|deadlines?)\b|\?|$)/i,
  );
  return match?.[1]?.trim() || null;
}
