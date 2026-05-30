/**
 * Thought splitter — splits a single long capture into multiple distinct thoughts.
 *
 * When you capture: "Meeting with Marcus went well. Also need to buy groceries.
 * And the dentist appointment is this Friday."
 *
 * → 3 separate timeline entries, each processed independently.
 *
 * Split triggers:
 * - Double newline (paragraph break)
 * - Transition phrases: "Also,", "Additionally,", "Another thing:", etc.
 * - Numbered items: "1. ...", "2. ..."
 * - Bullet points: "- ...", "• ..."
 *
 * Only splits if the message is substantial enough (>3 lines or >80 words)
 * and produces 2+ non-trivial segments.
 */

const SPLIT_PATTERNS = [
  // Paragraph break
  /\n\s*\n/,
  // Transition phrases at start of sentence
  /(?<=\.|\?|!|\n)\s+(?:Also(?:,| –| —)|Additionally(?:,| –)?|Another (?:thing|note|item)(?:,| –)?|And (?:also|another)|On the other hand|Besides that|Furthermore|Meanwhile|Separate(?:ly)?(?:,)?)/i,
];

const BULLET_LINE = /^\s*(?:[-•*]|\d+[.):])\s+/;

function minimalText(s: string): boolean {
  return s.trim().split(/\s+/).length >= 6;
}

export function splitThoughts(text: string): string[] {
  const wordCount = text.trim().split(/\s+/).length;
  const lineCount = text.trim().split('\n').length;

  // Don't split short messages
  if (wordCount < 30 && lineCount < 4) return [text];

  // Try paragraph splitting first
  const paraChunks = text.split(/\n\s*\n/).map((s) => s.trim()).filter(minimalText);
  if (paraChunks.length >= 2) {
    // Within each paragraph, also check for bullet/numbered lists
    const result: string[] = [];
    for (const para of paraChunks) {
      const lines = para.split('\n');
      const bulletLines = lines.filter((l) => BULLET_LINE.test(l));
      if (bulletLines.length >= 3 && bulletLines.length === lines.filter((l) => l.trim()).length) {
        // All lines are bullets — each bullet is a thought
        for (const line of bulletLines) {
          const t = line.replace(BULLET_LINE, '').trim();
          if (t.split(/\s+/).length >= 4) result.push(t);
        }
      } else {
        result.push(para);
      }
    }
    if (result.length >= 2) return result;
  }

  // Try bullet/numbered list splitting on a single block
  const lines = text.trim().split('\n').filter((l) => l.trim());
  const bulletLines = lines.filter((l) => BULLET_LINE.test(l));
  if (bulletLines.length >= 3 && bulletLines.length >= lines.length * 0.7) {
    const thoughts = bulletLines.map((l) => l.replace(BULLET_LINE, '').trim()).filter(minimalText);
    if (thoughts.length >= 2) return thoughts;
  }

  // Try sentence-level splitting on transition words (only for long text)
  if (wordCount >= 80) {
    // Split on ". Also " / ". Additionally " / ". Another " patterns
    const transitionSplit = text
      .replace(/\.\s+(Also|Additionally|Another thing|And another|Besides that|Separately)(?:,)?\s+/gi, '.|SPLIT|$1 ')
      .split('|SPLIT|')
      .map((s) => s.trim())
      .filter(minimalText);
    if (transitionSplit.length >= 2) return transitionSplit;
  }

  return [text];
}

export function shouldSplitThoughts(text: string): boolean {
  return splitThoughts(text).length >= 2;
}
