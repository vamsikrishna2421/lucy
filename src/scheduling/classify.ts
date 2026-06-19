/**
 * Heuristic task classifier → SchedTaskMeta. Deterministic, offline, and conservative: a task
 * we can't read confidently falls back to {focus, self} (exclusive) so it never silently
 * double-books. (An LLM pass can enrich this later; the heuristic is the foolproof baseline.)
 */
import type { EnergyLevel, ResourceAxis, SchedTaskMeta, TaskResources, TimeWindow } from './types';
import { DEFAULT_EXCLUSIVE } from './resources';

const LOCATIONS: Array<[RegExp, string]> = [
  [/\b(gym|workout|exercise|run|jog|yoga)\b/i, 'gym'],
  [/\b(office|work site|on-?site|desk)\b/i, 'office'],
  [/\b(grocery|groceries|supermarket|store|shop|mall|market)\b/i, 'store'],
  [/\b(doctor|dentist|clinic|hospital|appointment|checkup)\b/i, 'clinic'],
  [/\b(bank|atm)\b/i, 'bank'],
  [/\b(airport|flight|board)\b/i, 'airport'],
  [/\b(restaurant|lunch with|dinner with|cafe|coffee with)\b/i, 'restaurant'],
];
const PASSIVE_RE = /\b(laundry|dishwasher|wash(ing)? machine|download|backup|upload|charge|charging|soak|marinate|defrost|boil|let .* (run|rest|rise|prove)|water the plants)\b/i;
// Low-attention leisure media — light enough to ride ALONGSIDE another task (gym + a YouTube watchlist).
// Treated like passive so it holds no exclusive focus and can run in parallel.
const LEISURE_RE = /\b(watch(ing)?\s+(yt|youtube|tv|netflix|hulu|prime|a movie|movies|the game|a show|shows|series|episodes?|videos?)|youtube|netflix|hulu|a podcast|podcasts?|listen(ing)?\s+to\s+(music|a podcast|podcasts|something)|scroll(ing)?)\b/i;
const VOICE_RE = /\b(call|phone|ring|dial|standup|stand-up|sync|interview|discuss|catch up|1:1|one on one|talk to|speak (to|with)|meeting|meet with)\b/i;
const HANDS_RE = /\b(cook|bake|clean|tidy|repair|fix|build|assemble|paint|wash|chop|iron|garden|wrap)\b/i;
const DEEP_RE = /\b(write|draft|code|program|design|study|learn|research|analy[sz]e|plan|prepare|read|review|architect|outline|practice|deep work)\b/i;
const SHALLOW_RE = /\b(email|reply|respond|admin|pay|book|schedule|order|submit|fill|update|check|file|sort|organi[sz]e|message|text|send)\b/i;
const ERRAND_RE = /\b(buy|purchase|pick up|pickup|drop off|dropoff|return|collect|deliver|post|mail)\b/i;

function detectLocation(text: string): string | null {
  for (const [re, loc] of LOCATIONS) if (re.test(text)) return loc;
  return null;
}

// Work vs life signals — used to keep personal tasks out of office hours (and vice-versa). Generic so
// it isn't tied to one person's projects; returns null (unconstrained) when there's no clear signal.
const OFFICE_RE = /\b(meeting|standup|stand-up|sync|1:1|one on one|client|stakeholder|deploy|deployment|release|pipeline|prod|staging|qa|jira|ticket|sprint|backlog|pull request|\bpr\b|merge|code review|deck|presentation|report|spreadsheet|manager|colleague|team|office|work|boss|interview|onboarding|kpi|okrs?|standup|api|database|\bsql\b|server|config|migration|dbt|snowflake|databricks|alation|tidal|ad group|genie|poc)\b/i;
const PERSONAL_RE = /\b(gym|workout|exercise|run|yoga|grocery|groceries|family|mom|dad|mum|wife|husband|partner|kids?|friend|doctor|dentist|clinic|home|clean|laundry|cook|dinner|lunch with|movie|youtube|netflix|date night|birthday|anniversary|rent|lease|move|moving|vacation|trip|hobby|church|temple|personal|haircut|shopping|pharmacy)\b/i;

function detectDomain(text: string): 'office' | 'personal' | null {
  const office = OFFICE_RE.test(text);
  const personal = PERSONAL_RE.test(text);
  if (office && !personal) return 'office';
  if (personal && !office) return 'personal';
  return null; // ambiguous or unknown → leave unconstrained
}

/** Parse an explicit duration ("for 2 hours", "30 min", "45m", "1.5h"). */
export function parseDuration(text: string): number | null {
  let m = /\b(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours)\b/i.exec(text);
  if (m) return Math.round(parseFloat(m[1]) * 60);
  m = /\b(\d+)\s*(m|min|mins|minute|minutes)\b/i.exec(text);
  if (m) return parseInt(m[1], 10);
  return null;
}

/** Parse explicit time floors/ceilings: "after 6:30pm", "from 9", "before 9am", "by noon". */
export function detectTimeConstraints(text: string): { earliestMin: number | null; latestMin: number | null } {
  const eveningCtx = /\b(evening|night|tonight|pm)\b/i.test(text);
  const toMin = (h: number, m: number, mer: string | undefined): number => {
    let hh = h;
    if (mer) { const pm = /pm/i.test(mer); if (pm && hh < 12) hh += 12; if (!pm && hh === 12) hh = 0; }
    else if (hh <= 7 && eveningCtx) hh += 12; // "after 6:30" said in an evening context → 18:30
    return Math.min(23 * 60 + 59, hh * 60 + m);
  };
  let earliestMin: number | null = null;
  let latestMin: number | null = null;
  const after = /\b(?:after|from|past|starting(?:\s+at)?|post|no earlier than)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(text);
  if (after) earliestMin = toMin(Number(after[1]), Number(after[2] || 0), after[3]);
  const before = /\b(?:before|by|until|till|no later than)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(text);
  if (before) latestMin = toMin(Number(before[1]), Number(before[2] || 0), before[3]);
  if (/\bby noon\b/i.test(text)) latestMin = 12 * 60;
  return { earliestMin, latestMin };
}

/** Detect a recurrence intent ("every day", "every weekday", "weekly", "each morning"). */
export function detectRecurrence(text: string): 'daily' | 'weekdays' | 'weekly' | null {
  if (/\b(every weekday|on weekdays|each weekday)\b/i.test(text)) return 'weekdays';
  if (/\b(every week|weekly|each week)\b/i.test(text)) return 'weekly';
  if (/\b(every ?day|everyday|daily|each day|every morning|every evening|every night)\b/i.test(text)) return 'daily';
  return null;
}

function detectWindow(text: string): TimeWindow {
  if (/\b(morning|am\b|early)\b/i.test(text)) return 'morning';
  if (/\b(afternoon|midday|lunch)\b/i.test(text)) return 'afternoon';
  if (/\b(evening|tonight|night|after work|pm\b)\b/i.test(text)) return 'evening';
  return null;
}

const DEADLINE_DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DEADLINE_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DEADLINE_DAY_MS = 86_400_000;

/**
 * Best-effort deadline parse → ISO (end of that day), or null. ADDITIVE: earlier formats win, so the
 * original behavior (today/tonight, tomorrow, by|before|due <weekday>) is unchanged; later branches only
 * fire when those don't match. Also handles: next|this|on|coming <weekday>, "in N days/weeks",
 * month+day ("Aug 31", "31 August"), and "the 15th". Powers the commitment guardian, move/lease
 * autopilot, and scheduler — so it stays conservative (only confident matches resolve).
 */
export function parseDeadline(text: string, now = Date.now()): string | null {
  const t = text.toLowerCase();
  const d = new Date(now);
  const eod = (date: Date) => { date.setHours(23, 59, 0, 0); return date.toISOString(); };

  if (/\b(today|tonight|by end of day|eod)\b/.test(t)) { d.setHours(23, 59, 0, 0); return d.toISOString(); }
  if (/\btomorrow\b/.test(t)) { d.setDate(d.getDate() + 1); d.setHours(23, 59, 0, 0); return d.toISOString(); }

  const by = /\b(?:by|before|due)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.exec(t);
  if (by) {
    const target = DEADLINE_DAYS.indexOf(by[1]);
    let add = (target - d.getDay() + 7) % 7; if (add === 0) add = 7;
    d.setDate(d.getDate() + add); return eod(d);
  }

  // "next | this | on | coming <weekday>"
  const wd = /\b(next|this|on|coming)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.exec(t);
  if (wd) {
    const target = DEADLINE_DAYS.indexOf(wd[2]);
    let add = (target - d.getDay() + 7) % 7; if (add === 0) add = 7;
    if (wd[1] === 'next') add += 7; // "next Friday" → the following week
    d.setDate(d.getDate() + add); return eod(d);
  }

  // "in N days" / "in N weeks"
  const inN = /\bin\s+(\d{1,3})\s+(day|days|week|weeks)\b/.exec(t);
  if (inN) {
    const n = parseInt(inN[1], 10);
    d.setDate(d.getDate() + (inN[2].startsWith('week') ? n * 7 : n));
    return eod(d);
  }

  // month + day ("aug 31", "august 31st") or day + month ("31 aug", "31st of august")
  const MONTH = '(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)';
  let mo = -1; let dayNum = -1;
  const md = new RegExp(`\\b${MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`).exec(t);
  if (md) { mo = DEADLINE_MONTHS.indexOf(md[1].slice(0, 3)); dayNum = parseInt(md[2], 10); }
  else {
    const dm = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}\\b`).exec(t);
    if (dm) { mo = DEADLINE_MONTHS.indexOf(dm[2].slice(0, 3)); dayNum = parseInt(dm[1], 10); }
  }
  if (mo >= 0 && dayNum >= 1 && dayNum <= 31) {
    const cand = new Date(now); cand.setMonth(mo, dayNum); cand.setHours(23, 59, 0, 0);
    if (cand.getTime() < now - DEADLINE_DAY_MS) cand.setFullYear(cand.getFullYear() + 1); // already passed → next year
    return cand.toISOString();
  }

  // "the 15th" / "on the 5th" (ordinal required, so "the 2 items" never matches)
  const dom = /\bthe\s+(\d{1,2})(?:st|nd|rd|th)\b/.exec(t);
  if (dom) {
    const n = parseInt(dom[1], 10);
    if (n >= 1 && n <= 31) {
      const cand = new Date(now); cand.setDate(n); cand.setHours(23, 59, 0, 0);
      if (cand.getTime() < now - DEADLINE_DAY_MS) cand.setMonth(cand.getMonth() + 1); // passed → next month
      return cand.toISOString();
    }
  }

  return null;
}

/**
 * Classify free text (a task/todo title + optional context) into scheduling metadata.
 */
export function classifyTask(text: string, opts?: { durationMin?: number; deadline?: string | null }): SchedTaskMeta {
  const t = (text || '').trim();
  const lower = t.toLowerCase();
  const location = detectLocation(lower);
  const isPassive = (PASSIVE_RE.test(lower) || LEISURE_RE.test(lower)) && !DEEP_RE.test(lower);
  const isVoice = VOICE_RE.test(lower);
  const isHands = HANDS_RE.test(lower) && !isPassive;
  const isDeep = DEEP_RE.test(lower);
  const isShallow = SHALLOW_RE.test(lower);
  const isErrand = ERRAND_RE.test(lower) || !!location;

  let resources: TaskResources;
  let energy: EnergyLevel;
  let confidence = 0.8;

  if (isPassive) {
    resources = { axes: [], location: null };
    energy = 'passive';
  } else if (isVoice) {
    resources = { axes: ['voice', 'focus'], location };
    energy = 'shallow';
  } else if (location || isErrand) {
    const axes: ResourceAxis[] = ['self'];
    if (isHands) axes.push('hands');
    resources = { axes, location: location ?? 'out' };
    energy = 'shallow';
  } else if (isHands) {
    resources = { axes: ['hands'], location: null };
    energy = 'shallow';
  } else if (isDeep) {
    resources = { axes: ['focus'], location: null };
    energy = 'deep';
  } else if (isShallow) {
    resources = { axes: ['focus'], location: null };
    energy = 'shallow';
  } else {
    // Unknown → conservative default (focus + self), low confidence.
    resources = { axes: [...DEFAULT_EXCLUSIVE.axes], location: null };
    energy = 'shallow';
    confidence = 0.3;
  }

  const durationMin = opts?.durationMin
    ?? parseDuration(lower)
    ?? (energy === 'deep' ? 60 : isVoice ? 30 : isPassive ? 30 : energy === 'shallow' ? 20 : 30);

  const { earliestMin, latestMin } = detectTimeConstraints(lower);
  return {
    title: t,
    durationMin,
    resources,
    energy,
    location: resources.location ?? null,
    timeWindow: detectWindow(lower),
    deadline: opts?.deadline ?? parseDeadline(lower),
    earliestMin,
    latestMin,
    recurrence: detectRecurrence(lower),
    splittable: isDeep && durationMin >= 90,
    confidence,
    domain: detectDomain(lower),
  };
}
