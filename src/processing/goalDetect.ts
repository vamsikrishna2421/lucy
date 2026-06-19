/**
 * Savings-goal detector (extends money goals, Vamsi #2) — PURE. Turns "I want to save ₹2000 for the move
 * by August" / "set aside 50k for a new laptop" into a structured goal a propose-and-confirm card can offer.
 * Reuses the scheduler's parseDeadline; adds a bare-month deadline ("by August" → end of August) on top.
 * Conservative: requires save-intent AND a money-ish amount AND (a "for <label>" OR a deadline).
 */
import { parseDeadline } from '../scheduling/classify';

export interface DetectedGoal { label: string; target: number; currency: string; deadlineISO: string | null }

const SAVE_INTENT = /\b(save|saving|saving up|set aside|put aside|sock away|stash|build up)\b/i;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAY = 86_400_000;

/** "by August" / "in December" with NO day number → last day of that month (rolls to next year if past). */
function bareMonthDeadline(text: string, now: number): string | null {
  const m = /\b(?:by|in|before|until|for)\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t)?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b(?!\s*\d)/i.exec(text);
  if (!m) return null;
  const mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
  if (mo < 0) return null;
  const cand = new Date(now); cand.setMonth(mo + 1, 0); cand.setHours(23, 59, 0, 0); // day 0 of next month = last day of this one
  if (cand.getTime() < now - DAY) cand.setFullYear(cand.getFullYear() + 1);
  return cand.toISOString();
}

export function detectSavingsGoal(text: string, now = Date.now()): DetectedGoal | null {
  const t = (text || '').trim();
  const intentIdx = t.search(SAVE_INTENT);
  if (intentIdx < 0) return null;
  const after = t.slice(intentIdx);

  const m = /(₹|rs\.?|inr|\$|usd|€|£)?\s*(\d[\d,]*(?:\.\d+)?)\s*(k|thousand|lakhs?|lac|crores?|cr|m|mn|million)?\b/i.exec(after);
  if (!m) return null;
  const base = parseFloat(m[2].replace(/,/g, ''));
  if (!Number.isFinite(base) || base <= 0) return null;
  const suf = (m[3] || '').toLowerCase();
  let mult = 1;
  if (suf === 'k' || suf === 'thousand') mult = 1e3;
  else if (suf.startsWith('lakh') || suf === 'lac') mult = 1e5;
  else if (suf.startsWith('crore') || suf === 'cr') mult = 1e7;
  else if (suf === 'm' || suf === 'mn' || suf === 'million') mult = 1e6;
  const target = Math.round(base * mult);

  const sym = (m[1] || '').toLowerCase();
  let currency = '₹';
  if (sym.startsWith('$') || sym === 'usd') currency = '$';
  else if (sym === '€') currency = '€';
  else if (sym === '£') currency = '£';

  // Money-ish gate: a currency symbol, a magnitude suffix, or a meaningful amount (avoids "save 5 minutes").
  const moneyish = !!m[1] || !!m[3] || target >= 100;
  if (!moneyish) return null;

  const forM = /\bfor\s+(?:a\s+|an\s+|the\s+|my\s+)?([a-z][a-z0-9 ]{1,40}?)(?:\s+(?:by|before|until|in|within|this|next)\b|[.,;!?]|$)/i.exec(after);
  const deadlineISO = parseDeadline(after, now) ?? bareMonthDeadline(after, now);
  if (!forM && !deadlineISO) return null; // too vague to be a real goal

  let label = forM ? forM[1].trim().replace(/\s+/g, ' ') : 'Savings';
  label = label.charAt(0).toUpperCase() + label.slice(1);
  return { label, target, currency, deadlineISO };
}
