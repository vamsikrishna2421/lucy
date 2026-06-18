/**
 * Privacy Shield — deterministic, on-device detection of passwords + people names,
 * with tokenize/restore so sensitive values never reach the remote LLM in plaintext.
 *
 * Flow: shieldText() replaces each detected value with a placeholder ([SECRET_n] /
 * [PERSON_n]) before a remote call; restoreText() swaps the originals back into the
 * response. Detection is fully deterministic (regex + your saved contacts + a name
 * gazetteer + cue phrases) — no LLM, nothing leaves the device to detect.
 */
import { COMMON_FIRST_NAMES, CAPITALIZED_STOPWORDS } from './sensitiveNames.data';
import type { ExtractionResult } from '../types/extraction';

export type ShieldKind = 'secret' | 'person';
export interface ProtectedValue { value: string; kind: ShieldKind; }
export interface ShieldEntry { token: string; value: string; kind: ShieldKind; }
export interface ShieldResult { redacted: string; map: ShieldEntry[]; }

// Passwords / credentials. A mandatory separator (is/=/:) after the keyword prevents
// grabbing an unrelated following word (e.g. "change my password" has no value).
const SECRET_PATTERNS: RegExp[] = [
  /\b(?:wifi\s+)?password\s*(?:is|=|:)\s*([^\s,;.!?]+)/gi,
  /\bpasscode\s*(?:is|=|:)\s*([^\s,;.!?]+)/gi,
  /\bpin\s*(?:is|=|:)\s*(\d{3,12})\b/gi,
  /\botp\s*(?:is|=|:)\s*(\d{4,12})\b/gi,
  /\b(?:account|acct)\s*(?:number|no\.?|#)\s*(?:is|=|:)?\s*([A-Za-z0-9-]{5,32})\b/gi,
  /\b(?:cvv|cvc)\s*(?:is|=|:)?\s*(\d{3,4})\b/gi,
];
const CARD_PATTERN = /\b(?:\d[ -]*?){13,19}\b/g;

// Relational cues that flag the adjacent capitalized word as a person, even if it
// isn't a saved contact or in the gazetteer.
// Cues are matched case-insensitively (they can open a sentence, e.g. "Meet ..."),
// but the captured name must still be Capitalized (checked in code).
const CUE_BEFORE = /\b(?:met with|meet with|met|meet|meeting|with|saw|seeing|call|called|calling|text|texted|message|messaged|email|emailed|told|tell|ask|asked|thank|thanked|spoke to|speak to|talked to|talk to)\s+([A-Za-z]+)\b/gi;
const CUE_AFTER = /\b([A-Za-z]+)\s+(?:said|told|asked|called|texted|messaged|emailed|mentioned|wants|needs|came over|stopped by|gave me|sent me)\b/gi;
// A run of 1-3 consecutive capitalized words — so a full name ("Jan Pyda") is caught
// as a unit once its first word qualifies as a person.
const CAPITAL_RUN = /\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2}\b/g;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Detects every password and person name in the text. Secrets take precedence when a
 * string would match both. Returns unique values (case-insensitive).
 */
export function findProtectedValues(text: string, contacts: string[] = []): ProtectedValue[] {
  // value(lowercased) -> kind, secret wins over person.
  const byValue = new Map<string, { value: string; kind: ShieldKind }>();
  const record = (raw: string, kind: ShieldKind) => {
    const value = raw.trim();
    if (!value) return;
    const key = value.toLowerCase();
    const existing = byValue.get(key);
    if (existing && existing.kind === 'secret') return; // secret already wins
    if (!existing || kind === 'secret') byValue.set(key, { value, kind });
  };

  // --- Secrets ---
  for (const re of SECRET_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) if (m[1]) record(m[1], 'secret');
  }
  CARD_PATTERN.lastIndex = 0;
  let cm: RegExpExecArray | null;
  while ((cm = CARD_PATTERN.exec(text)) !== null) record(cm[0].trim(), 'secret');

  // --- People names ---
  const contactSet = new Set<string>();
  for (const c of contacts) {
    const name = c.trim();
    if (name.length < 2) continue;
    contactSet.add(name.toLowerCase());
    const first = name.split(/\s+/)[0];
    if (first.length >= 2) contactSet.add(first.toLowerCase());
  }

  const cueNames = new Set<string>();
  for (const re of [CUE_BEFORE, CUE_AFTER]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const name = m[1];
      // The cue word itself is matched case-insensitively, but only treat the captured
      // word as a name if it is Capitalized and not a common non-name word.
      if (name && /^[A-Z]/.test(name) && !CAPITALIZED_STOPWORDS.has(name.toLowerCase())) {
        cueNames.add(name.toLowerCase());
      }
    }
  }

  const isName = (w: string): boolean => {
    const lower = w.toLowerCase();
    return contactSet.has(lower) || COMMON_FIRST_NAMES.has(lower) || cueNames.has(lower);
  };

  // Collect capitalized runs with their positions so we can propagate across
  // conjunctions: in "Priya and Raghavendra", only "Priya" has a cue, but the name
  // after "and"/","/"&" is a person too.
  const runs: Array<{ start: number; end: number; words: string[] }> = [];
  CAPITAL_RUN.lastIndex = 0;
  let rm: RegExpExecArray | null;
  while ((rm = CAPITAL_RUN.exec(text)) !== null) {
    runs.push({ start: rm.index, end: rm.index + rm[0].length, words: rm[0].split(/\s+/) });
  }

  let prevPersonEnd = -1;
  for (const run of runs) {
    // Find the first word that qualifies as a person (skipping non-name capitalized
    // words like a sentence-opening "Meet").
    let start = -1;
    for (let i = 0; i < run.words.length; i++) {
      if (CAPITALIZED_STOPWORDS.has(run.words[i].toLowerCase())) continue;
      if (isName(run.words[i])) { start = i; break; }
    }
    // Conjunction propagation: if this run isn't a known name on its own but directly
    // follows a person via "and" / "&" / "," (e.g. "...and Raghavendra"), treat its first
    // non-stopword word as a name too.
    if (start === -1 && prevPersonEnd >= 0 && /^[\s,]*(?:and|&|,|or)[\s,]*$/i.test(text.slice(prevPersonEnd, run.start))) {
      for (let i = 0; i < run.words.length; i++) {
        if (!CAPITALIZED_STOPWORDS.has(run.words[i].toLowerCase())) { start = i; break; }
      }
    }
    if (start === -1) continue;
    // Extend through following capitalized words (the surname) until a stopword.
    const nameWords: string[] = [];
    for (let i = start; i < run.words.length; i++) {
      if (CAPITALIZED_STOPWORDS.has(run.words[i].toLowerCase())) break;
      nameWords.push(run.words[i]);
    }
    if (nameWords.length) {
      record(nameWords.join(' '), 'person');
      prevPersonEnd = run.end;
    }
  }

  return [...byValue.values()];
}

/** Replaces every detected value with a stable placeholder token. */
export function shieldText(text: string, contacts: string[] = []): ShieldResult {
  const values = findProtectedValues(text, contacts);
  // Longest first so a longer value isn't clobbered by a shorter substring of it.
  values.sort((a, b) => b.value.length - a.value.length);
  const map: ShieldEntry[] = [];
  let secretN = 0;
  let personN = 0;
  let redacted = text;
  for (const pv of values) {
    const token = pv.kind === 'secret' ? `[SECRET_${++secretN}]` : `[PERSON_${++personN}]`;
    const esc = escapeRegExp(pv.value);
    const left = /^[A-Za-z0-9]/.test(pv.value) ? '\\b' : '';
    const right = /[A-Za-z0-9]$/.test(pv.value) ? '\\b' : '';
    // Names match case-insensitively (Sam/sam); secrets are case-sensitive.
    const re = new RegExp(`${left}${esc}${right}`, pv.kind === 'person' ? 'gi' : 'g');
    redacted = redacted.replace(re, token);
    map.push({ token, value: pv.value, kind: pv.kind });
  }
  return { redacted, map };
}

/**
 * Swaps placeholder tokens back to their original values.
 *
 * Tolerant by design: LLMs frequently mangle the exact token form (drop the brackets,
 * lowercase it, add a space, use a dash) — e.g. "[PERSON_1]" comes back as "PERSON 1",
 * "person_1", or "[Person-1]". A brittle exact match would leak the raw token to the
 * user. So we match any kind+number variant and look the value up. The greedy `\d+`
 * also prevents PERSON_1 from clobbering inside PERSON_11.
 */
export function restoreText(text: string, map: ShieldEntry[]): string {
  if (!map.length) return text;
  // kind+number -> value (parsed from each token, which is always "[SECRET_n]" / "[PERSON_n]").
  const byKey = new Map<string, ShieldEntry>();
  for (const entry of map) {
    const m = entry.token.match(/(SECRET|PERSON)_(\d+)/i);
    if (m) byKey.set(`${m[1].toUpperCase()}_${m[2]}`, entry);
  }
  // Exact pass first (fast, lossless), then a tolerant pass for any mangled survivors.
  let out = text;
  for (const entry of map) out = out.split(entry.token).join(entry.value);
  out = out.replace(/\[?\s*(SECRET|PERSON)[\s_-]*?(\d+)\s*\]?/gi, (full, kind: string, n: string) => {
    const hit = byKey.get(`${kind.toUpperCase()}_${n}`);
    if (hit) return hit.value;
    // Unknown token (model hallucinated a number we never issued) — never show the raw token.
    return kind.toUpperCase() === 'PERSON' ? 'them' : '(hidden)';
  });
  return out;
}

/** The list of {value, kind} actually protected — stored per capture for UI highlighting. */
export function protectedValuesFromMap(map: ShieldEntry[]): ProtectedValue[] {
  return map.map(({ value, kind }) => ({ value, kind }));
}

/** Note appended to a remote system prompt so the model surfaces placeholder tokens. */
export const PLACEHOLDER_NOTE =
  '\n\nCRITICAL — PRIVACY TOKENS: Some values appear as tokens like [SECRET_1] (a password/credential) or [PERSON_1] (a person\'s name). Each token stands for the user\'s OWN real value, which the app safely restores on the user\'s device. Treat every token AS the value it represents. Whenever the content calls for that value — in summaries AND when answering direct questions like "what is my wifi password" — include the exact token verbatim (e.g. "Your Wi-Fi password is [SECRET_1]."). NEVER say you do not have access, NEVER refuse, and NEVER alter or explain the tokens. The user sees the real value, not the token.';

/** Restores placeholder tokens across every string field of an extraction result.
 *  Defensive: tolerates partially-populated results (fields may be missing pre-normalize). */
export function rehydrateExtraction(r: ExtractionResult, map: ShieldEntry[]): ExtractionResult {
  if (!map.length) return r;
  const R = (s: string | null | undefined): string => (s ? restoreText(s, map) : (s ?? ''));
  const arr = <T>(v: T[] | undefined): T[] => v ?? [];
  return {
    ...r,
    title: R(r.title),
    summary: R(r.summary),
    projects: arr(r.projects).map(R),
    areas: arr(r.areas).map(R),
    people: arr(r.people).map(R),
    tasks: arr(r.tasks).map((t) => ({ ...t, task: R(t.task), context: R(t.context) })),
    expenses: arr(r.expenses).map((e) => ({ ...e, description: R(e.description) })),
    ideas: arr(r.ideas).map((i) => ({ ...i, title: R(i.title), description: R(i.description) })),
    places: arr(r.places).map((p) => ({ ...p, name: R(p.name), reason: R(p.reason) })),
    interests: arr(r.interests).map((i) => ({ ...i, topic: R(i.topic), evidence: R(i.evidence) })),
    decisions: arr(r.decisions).map(R),
    reminders: arr(r.reminders).map((rm) => ({ ...rm, text: R(rm.text) })),
    tags: arr(r.tags).map(R),
    suggested_folders: arr(r.suggested_folders).map(R),
    clarifications: arr(r.clarifications).map((c) => ({ ...c, snippet: R(c.snippet), question: R(c.question) })),
    memory_gaps: arr(r.memory_gaps).map((g) => ({
      ...g, question: R(g.question), context: R(g.context),
      answer: g.answer ? R(g.answer) : g.answer,
      notification: g.notification ? R(g.notification) : g.notification,
    })),
    open_loops: arr(r.open_loops).map((o) => ({ ...o, description: R(o.description) })),
    follow_ups: arr(r.follow_ups).map((f) => ({ ...f, assignee: R(f.assignee), action: R(f.action) })),
    detected_action: r.detected_action
      ? {
          ...r.detected_action,
          displayText: R(r.detected_action.displayText),
          confirmText: R(r.detected_action.confirmText),
          params: Object.fromEntries(
            Object.entries(r.detected_action.params ?? {}).map(([k, v]) => [k, R(v)]),
          ),
        }
      : null,
  };
}
