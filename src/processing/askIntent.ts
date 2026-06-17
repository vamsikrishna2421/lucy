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
  return /\b(when (should|can|do|could) i|find (me )?(a )?time|best time|good time|what time should|schedule (a|an|some|this|that|my|the)|plan my day|fit (it|this|that|.+) (in|into)|book (time|a slot|me)|squeeze in|make time for|free time for|time to)\b/i.test(question);
}

/** Strips the scheduling phrasing to recover the underlying task ("find time to call mom" → "call mom"). */
export function extractSchedulableTask(question: string): string {
  let t = question.trim();
  t = t.replace(/^\s*(hey )?lucy[,\s]+/i, '');
  t = t.replace(/\b(when (should|can|do|could) i|what time should i|find (me )?(a )?time (to|for)?|best time (to|for)?|good time (to|for)?|schedule|book (time )?(to|for)?|make time (to|for)?|squeeze in|fit (in )?|free time for|i need to|i want to|i have to|time to)\b/gi, ' ');
  t = t.replace(/\b(today|tomorrow|this week|next week|please|sometime|some time)\b/gi, ' ');
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
