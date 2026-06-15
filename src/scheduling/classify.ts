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
const VOICE_RE = /\b(call|phone|ring|dial|standup|stand-up|sync|interview|discuss|catch up|1:1|one on one|talk to|speak (to|with)|meeting|meet with)\b/i;
const HANDS_RE = /\b(cook|bake|clean|tidy|repair|fix|build|assemble|paint|wash|chop|iron|garden|wrap)\b/i;
const DEEP_RE = /\b(write|draft|code|program|design|study|learn|research|analy[sz]e|plan|prepare|read|review|architect|outline|practice|deep work)\b/i;
const SHALLOW_RE = /\b(email|reply|respond|admin|pay|book|schedule|order|submit|fill|update|check|file|sort|organi[sz]e|message|text|send)\b/i;
const ERRAND_RE = /\b(buy|purchase|pick up|pickup|drop off|dropoff|return|collect|deliver|post|mail)\b/i;

function detectLocation(text: string): string | null {
  for (const [re, loc] of LOCATIONS) if (re.test(text)) return loc;
  return null;
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

/** Best-effort deadline parse → ISO, or null. Handles today/tomorrow/by <weekday>. */
export function parseDeadline(text: string, now = Date.now()): string | null {
  const t = text.toLowerCase();
  const d = new Date(now);
  if (/\b(today|tonight|by end of day|eod)\b/.test(t)) { d.setHours(23, 59, 0, 0); return d.toISOString(); }
  if (/\btomorrow\b/.test(t)) { d.setDate(d.getDate() + 1); d.setHours(23, 59, 0, 0); return d.toISOString(); }
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const m = /\b(?:by|before|due)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.exec(t);
  if (m) {
    const target = days.indexOf(m[1]);
    let add = (target - d.getDay() + 7) % 7; if (add === 0) add = 7;
    d.setDate(d.getDate() + add); d.setHours(23, 59, 0, 0); return d.toISOString();
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
  const isPassive = PASSIVE_RE.test(lower) && !DEEP_RE.test(lower);
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
  };
}
