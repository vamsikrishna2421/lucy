/**
 * On-device heuristic sentiment — a free, offline fallback so EVERY capture contributes a mood point
 * (the LLM mood is preferred when the extraction succeeds; this guarantees degraded/plain-note captures
 * and lazy "neutral" results still register a feeling). Returns the same {tone, energy} shape as the
 * extraction's MoodEntry. Pure + deterministic (tested in tests/sentiment.ts).
 */
import type { MoodEntry } from '../types/extraction';

type Tone = MoodEntry['tone'];     // 'positive'|'negative'|'neutral'|'stressed'|'excited'|'frustrated'|'calm'
type Energy = MoodEntry['energy']; // 'high'|'medium'|'low'

// Small, high-signal lexicons (substring/word match, lowercased). Kept deliberately tight to avoid noise.
const LEX: Record<Exclude<Tone, 'neutral'>, RegExp> = {
  excited: /\b(excited|can'?t wait|stoked|pumped|thrilled|amazing|awesome|let'?s go|yay|woohoo|finally|landed|shipped|nailed it|love this|so happy|great news)\b/i,
  positive: /\b(happy|glad|grateful|good|great|wonderful|nice|proud|relieved|enjoyed|fun|love|content|optimistic|hopeful|win|progress|productive)\b/i,
  stressed: /\b(stressed|stress|overwhelm|overwhelmed|anxious|anxiety|worried|worry|panic|pressure|deadline|too much|burned? out|burnout|exhausted|drained|swamped|can'?t keep up|no time)\b/i,
  frustrated: /\b(frustrat|annoyed|annoying|angry|mad|irritat|fed up|ugh|stuck|blocked|broken|failing|hate|sick of|again\?!|why won'?t|not working)\b/i,
  negative: /\b(sad|down|low|depress|lonely|tired|hopeless|miserable|upset|hurt|disappointed|cry|crying|bad day|rough|terrible|awful|defeated|empty)\b/i,
  calm: /\b(calm|relaxed|peaceful|chill|rested|at ease|content|settled|quiet|cozy|grounded|fine|okay|ok)\b/i,
};

// Energy modifiers.
const HIGH_E = /\b(excited|pumped|stoked|energi|wired|busy|rushing|sprint|hyped|can'?t wait|panic|stressed|overwhelm)\b|!{2,}/i;
const LOW_E = /\b(tired|exhausted|drained|sleepy|low|down|depress|lazy|slow|burned? out|burnout|calm|relaxed|rested|sluggish|worn out)\b/i;

export interface Sentiment { tone: Tone; energy: Energy; confidence: number }

/** Score text for emotional tone + energy. confidence 0 ⇒ no signal found (neutral). */
export function analyzeSentiment(text: string): Sentiment {
  const t = (text || '').toLowerCase();
  if (!t.trim()) return { tone: 'neutral', energy: 'medium', confidence: 0 };

  // Count hits per tone; strongest wins. Order matters only for ties (stronger feelings first).
  const order: Array<Exclude<Tone, 'neutral'>> = ['excited', 'stressed', 'frustrated', 'negative', 'positive', 'calm'];
  let best: Exclude<Tone, 'neutral'> | null = null;
  let bestHits = 0;
  for (const tone of order) {
    const m = t.match(new RegExp(LEX[tone].source, 'gi'));
    const hits = m ? m.length : 0;
    if (hits > bestHits) { bestHits = hits; best = tone; }
  }

  const energy: Energy = HIGH_E.test(t) ? 'high' : LOW_E.test(t) ? 'low' : 'medium';
  if (!best) return { tone: 'neutral', energy, confidence: 0 };
  return { tone: best, energy, confidence: Math.min(1, bestHits / 2) };
}

/** Whether a parsed mood looks like the schema's bare default (so a real signal should override it). */
export function isDefaultMood(mood: { tone: string; energy: string } | null | undefined): boolean {
  return !mood || (mood.tone === 'neutral' && mood.energy === 'medium');
}
