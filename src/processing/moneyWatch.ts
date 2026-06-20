/**
 * Money that watches itself (Vamsi top-6 #4). Turns LUCY's expense ledger from a passive record into a
 * quiet financial guardian: it detects recurring charges/subscriptions, forecasts the next bill due,
 * flags month-over-month category drift, and surfaces anomalous (unusually large) charges.
 *
 * 100% on-device pattern detection over what the user already logs — NO Plaid, NO bank login. Pure
 * functions (testable) + a thin getMoneyInsights(db) that reads the ledger and returns human strings.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import type { ExpenseRow } from '../db/expenses';
import { dbDateMs } from '../utils/datetime';

const DAY = 86_400_000;

/** Parse the stored "YYYY-MM-DD HH:MM:SS" (UTC) timestamp to ms, or NaN. */
function ts(createdAt: string): number {
  return dbDateMs(createdAt);
}

/** A stable "merchant" key from a free-text description — drop amounts, dates, ids; keep the words. */
export function merchantKey(description: string): string {
  return (description || '')
    .toLowerCase()
    .replace(/\$?\d[\d,.]*/g, ' ')       // amounts / numbers
    .replace(/[^a-z\s]/g, ' ')           // punctuation
    .replace(/\b(payment|paid|bill|charge|charged|for|the|my|to|of|on|a|an)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function money(n: number): string {
  return n >= 100 ? `$${Math.round(n)}` : `$${n.toFixed(n % 1 === 0 ? 0 : 2)}`;
}

export type Cadence = 'weekly' | 'monthly' | 'quarterly';

export interface RecurringCharge {
  key: string;
  label: string;        // a readable name (the most common description in the group)
  amount: number;       // typical (median) amount
  cadence: Cadence;
  category: string;
  lastChargedMs: number;
  nextDueMs: number;
  count: number;
}

function cadenceOf(days: number): Cadence | null {
  if (days >= 6 && days <= 9) return 'weekly';
  if (days >= 25 && days <= 35) return 'monthly';
  if (days >= 82 && days <= 98) return 'quarterly';
  return null;
}

/** Detect recurring charges: groups of ≥2 same-merchant charges spaced at a regular cadence. */
export function detectRecurring(expenses: ExpenseRow[], now = Date.now()): RecurringCharge[] {
  const groups = new Map<string, ExpenseRow[]>();
  for (const e of expenses) {
    if (e.amount == null || e.amount <= 0) continue;
    const key = merchantKey(e.description);
    if (key.length < 3) continue;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(e);
  }

  const out: RecurringCharge[] = [];
  for (const [key, rows] of groups) {
    const dated = rows
      .map((r) => ({ r, t: ts(r.created_at) }))
      .filter((x) => Number.isFinite(x.t))
      .sort((a, b) => a.t - b.t);
    if (dated.length < 2) continue;

    const intervals: number[] = [];
    for (let i = 1; i < dated.length; i++) intervals.push((dated[i].t - dated[i - 1].t) / DAY);
    const med = median(intervals);
    const cadence = cadenceOf(med);
    if (!cadence) continue;

    const amounts = dated.map((x) => x.r.amount as number);
    const lastChargedMs = dated[dated.length - 1].t;
    const periodDays = cadence === 'weekly' ? 7 : cadence === 'monthly' ? 30.4 : 91;
    // Pick the most frequent description as the label.
    const label = rows.map((r) => r.description).sort((a, b) =>
      rows.filter((r) => r.description === b).length - rows.filter((r) => r.description === a).length)[0] || key;

    out.push({
      key,
      label: label.trim(),
      amount: Math.round(median(amounts) * 100) / 100,
      cadence,
      category: dated[dated.length - 1].r.category || 'other',
      lastChargedMs,
      nextDueMs: lastChargedMs + periodDays * DAY,
      count: dated.length,
    });
  }
  return out.sort((a, b) => a.nextDueMs - b.nextDueMs);
}

/** Recurring charges whose next due date lands within the forecast horizon (default 5 days). */
export function forecastUpcomingBills(recurring: RecurringCharge[], now = Date.now(), horizonDays = 5): string[] {
  const out: string[] = [];
  for (const r of recurring) {
    const days = Math.round((r.nextDueMs - now) / DAY);
    if (days < -2 || days > horizonDays) continue;
    const when = days <= 0 ? 'around now' : days === 1 ? 'tomorrow' : `in ${days} days`;
    out.push(`${capitalize(r.label)} (${money(r.amount)}/${r.cadence === 'monthly' ? 'mo' : r.cadence === 'weekly' ? 'wk' : 'qtr'}) renews ${when}.`);
  }
  return out;
}

/** Month-over-month drift: categories where this month's pace is well above the recent baseline. */
export function detectCategoryDrift(expenses: ExpenseRow[], now = Date.now()): string[] {
  const d = new Date(now);
  const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const dayOfMonth = d.getDate();
  const elapsed = Math.max(0.1, dayOfMonth / daysInMonth);

  // This-month-so-far per category + baseline (avg of the prior 2 full months) per category.
  const thisMonth = new Map<string, number>();
  const prior = new Map<string, number[]>(); // category -> [monthTotal, monthTotal]
  const priorBuckets = [
    { start: new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime(), end: monthStart },
    { start: new Date(d.getFullYear(), d.getMonth() - 2, 1).getTime(), end: new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime() },
  ];

  for (const e of expenses) {
    if (e.amount == null || e.amount <= 0) continue;
    const t = ts(e.created_at);
    if (!Number.isFinite(t)) continue;
    const cat = e.category || 'other';
    if (t >= monthStart) thisMonth.set(cat, (thisMonth.get(cat) ?? 0) + e.amount);
    for (let i = 0; i < priorBuckets.length; i++) {
      if (t >= priorBuckets[i].start && t < priorBuckets[i].end) {
        const arr = prior.get(cat) ?? [0, 0];
        arr[i] += e.amount; prior.set(cat, arr);
      }
    }
  }

  const out: Array<{ msg: string; over: number }> = [];
  for (const [cat, spent] of thisMonth) {
    const priorMonths = (prior.get(cat) ?? []).filter((v) => v > 0);
    if (priorMonths.length === 0) continue; // no baseline to compare against
    const baseline = priorMonths.reduce((a, b) => a + b, 0) / priorMonths.length;
    const pace = baseline * elapsed; // expected spend by this day of the month
    const over = spent - pace;
    if (over > 50 && spent > pace * 1.3) {
      out.push({ msg: `You're ${money(over)} over your usual ${cat} for this point in the month (${money(spent)} vs ~${money(pace)}).`, over });
    }
  }
  return out.sort((a, b) => b.over - a.over).map((x) => x.msg);
}

/** Anomaly: a recent charge that's much larger than the user's typical charge in that category. */
export function detectAnomalies(expenses: ExpenseRow[], now = Date.now(), recentDays = 7): string[] {
  const byCat = new Map<string, number[]>();
  for (const e of expenses) {
    if (e.amount == null || e.amount <= 0) continue;
    (byCat.get(e.category || 'other') ?? byCat.set(e.category || 'other', []).get(e.category || 'other')!).push(e.amount);
  }
  const out: Array<{ msg: string; ratio: number }> = [];
  const seen = new Set<string>();
  for (const e of expenses) {
    if (e.amount == null || e.amount <= 40) continue;
    const t = ts(e.created_at);
    if (!Number.isFinite(t) || t < now - recentDays * DAY) continue;
    const cat = e.category || 'other';
    const others = (byCat.get(cat) ?? []).filter((a) => a !== e.amount);
    if (others.length < 3) continue; // need a baseline of normal charges
    const typical = median(others);
    if (typical <= 0) continue;
    const ratio = e.amount / typical;
    const dedup = `${cat}:${Math.round(e.amount)}`;
    if (ratio >= 2.5 && !seen.has(dedup)) {
      seen.add(dedup);
      out.push({ msg: `That ${money(e.amount)} ${e.description.trim()} is well above your usual ${cat} (~${money(typical)}) — worth a glance.`, ratio });
    }
  }
  return out.sort((a, b) => b.ratio - a.ratio).map((x) => x.msg);
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * The whole money-watch readout as prioritized human lines: bills due first (most actionable),
 * then anomalies, then drift. Returns [] when there's nothing worth saying (no scary empty noise).
 */
export async function getMoneyInsights(db: SQLiteDatabase, now = Date.now()): Promise<string[]> {
  let expenses: ExpenseRow[] = [];
  try {
    const { listExpenses } = await import('../db/expenses');
    expenses = await listExpenses(db);
  } catch { return []; }
  if (expenses.length < 4) return []; // not enough history to say anything useful

  const recurring = detectRecurring(expenses, now);
  const lines: string[] = [
    ...forecastUpcomingBills(recurring, now),
    ...detectAnomalies(expenses, now),
    ...detectCategoryDrift(expenses, now),
  ];
  // De-dup and cap — LUCY stays calm, not noisy.
  return [...new Set(lines)].slice(0, 4);
}
