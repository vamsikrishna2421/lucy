/**
 * Commitment / deadline extractor — FOUNDATION for the "commitment guardian" (Vamsi top-6 #1).
 *
 * Detects promises the user MAKES ("I'll send the Alation doc to Raghavendra by Thursday") and things
 * they're OWED ("Priya will send me the file by Friday") so a future guardian can track who-owes-what-
 * by-when and chase the at-risk ones. PURE + deterministic + tested. NOT wired into extraction/DB/UI
 * yet — that wiring (schema for an obligations list + the at-risk surface) is a product decision for the
 * user; see project_pending_approval. Reuses the scheduler's parseDeadline so dates resolve consistently.
 */
import { parseDeadline } from '../scheduling/classify';

export type CommitmentDirection = 'i-owe' | 'owed-to-me';

export interface Commitment {
  text: string;                 // the source sentence/clause the commitment came from
  action: string;               // best-effort "what" (verb + object), trimmed
  counterparty: string | null;  // the other person, when named
  dueISO: string | null;        // resolved deadline (ISO) or null
  direction: CommitmentDirection;
}

const OWE_VERB = '(send|share|email|get|give|deliver|finish|submit|return|pay|prepare|write|review|reply|call|forward|update|fix|complete|drop off|hand over)';

// Things the USER promised: "I'll send …", "I need to get …", "I owe …", "I promised …".
const I_OWE_RE = new RegExp(
  `\\bi\\s*(?:'ll|’ll| will| have to| need to| gotta| must| should|'?ve got to| promised(?: to)?|'?m going to| am going to| owe)\\s+(?:to\\s+)?${OWE_VERB}\\b([^.!?\\n]*)`,
  'i',
);
// Things OWED TO the user: "Priya will send me …", "X owes me …", "waiting on X for …".
const OWED_RE = new RegExp(
  `\\b([A-Z][a-zA-Z]+)\\s+(?:will|is going to|'s going to|promised to|needs? to|owes? me|is supposed to)\\s+(?:${OWE_VERB})\\b([^.!?\\n]*)`,
);
// "I owe Dana the invoice" — here "owe" is itself the verb (no following action verb).
const I_OWE_DIRECT_RE = /\bi\s+owe\s+([^.!?\n]*)/i;
const WAITING_RE = /\bwaiting (?:on|for)\s+([A-Z][a-zA-Z]+)\b([^.!?\n]*)/;

/** First capitalized name in a clause, skipping pronouns/articles. */
function firstName(tail: string): string | null {
  const m = /\b([A-Z][a-zA-Z]+)\b/.exec(tail);
  return m && !NAME_STOP.has(m[1]) ? m[1] : null;
}

const NAME_STOP = new Set(['I', 'We', 'The', 'A', 'An', 'My', 'Our', 'It', 'This', 'That', 'They', 'He', 'She', 'You']);

/** Pull a person name that follows "to " in a clause ("…to Raghavendra by Thu" → "Raghavendra"). */
function counterpartyAfterTo(tail: string): string | null {
  const m = /\bto\s+([A-Z][a-zA-Z]+)\b/.exec(tail);
  if (m && !NAME_STOP.has(m[1])) return m[1];
  return null;
}

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').replace(/\s*[,.;:]+\s*$/, '').trim();
}

/** Extract commitments from a capture's text. Splits on sentence boundaries so each clause is judged. */
export function extractCommitments(text: string, now = Date.now()): Commitment[] {
  const out: Commitment[] = [];
  const seen = new Set<string>();
  const sentences = (text || '').split(/(?<=[.!?\n])\s+/);

  for (const sentenceRaw of sentences) {
    const sentence = sentenceRaw.trim();
    if (!sentence) continue;

    const mine = I_OWE_RE.exec(sentence);
    if (mine) {
      const verb = mine[1];
      const tail = mine[2] ?? '';
      const action = clean(`${verb} ${tail}`);
      const c: Commitment = {
        text: clean(sentence),
        action,
        counterparty: counterpartyAfterTo(tail),
        dueISO: parseDeadline(sentence, now),
        direction: 'i-owe',
      };
      const key = `i|${action.toLowerCase()}`;
      if (!seen.has(key)) { seen.add(key); out.push(c); }
      continue;
    }

    const oweDirect = I_OWE_DIRECT_RE.exec(sentence);
    if (oweDirect) {
      const tail = oweDirect[1] ?? '';
      const c: Commitment = {
        text: clean(sentence),
        action: clean(`owe ${tail}`),
        counterparty: firstName(tail),
        dueISO: parseDeadline(sentence, now),
        direction: 'i-owe',
      };
      const key = `i|${c.action.toLowerCase()}`;
      if (!seen.has(key)) { seen.add(key); out.push(c); }
      continue;
    }

    const owed = OWED_RE.exec(sentence);
    if (owed && !NAME_STOP.has(owed[1])) {
      const person = owed[1];
      const verb = owed[2];
      const tail = owed[3] ?? '';
      const c: Commitment = {
        text: clean(sentence),
        action: clean(`${verb} ${tail}`),
        counterparty: person,
        dueISO: parseDeadline(sentence, now),
        direction: 'owed-to-me',
      };
      const key = `o|${person.toLowerCase()}|${c.action.toLowerCase()}`;
      if (!seen.has(key)) { seen.add(key); out.push(c); }
      continue;
    }

    const waiting = WAITING_RE.exec(sentence);
    if (waiting && !NAME_STOP.has(waiting[1])) {
      const person = waiting[1];
      const c: Commitment = {
        text: clean(sentence),
        action: clean(`waiting for ${waiting[2] ?? ''}` || 'a reply'),
        counterparty: person,
        dueISO: parseDeadline(sentence, now),
        direction: 'owed-to-me',
      };
      const key = `w|${person.toLowerCase()}`;
      if (!seen.has(key)) { seen.add(key); out.push(c); }
    }
  }
  return out;
}

/** Of the extracted commitments, the ones that are at risk now: have a due date that is past or within
 *  the given lookahead window (default 48h) and still open. (No persistence here — caller supplies the set.) */
export function atRiskCommitments(commitments: Commitment[], now = Date.now(), withinMs = 48 * 60 * 60 * 1000): Commitment[] {
  return commitments.filter((c) => {
    if (!c.dueISO) return false;
    const due = Date.parse(c.dueISO);
    return Number.isFinite(due) && due <= now + withinMs;
  });
}
