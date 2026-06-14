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
  const monthly = /\b(this month|this\s+month'?s|monthly|past month|last month)\b/i.test(question);
  if (monthly) return false;
  return true;
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
