/**
 * LUCY Lens — visual memory extraction.
 *
 * Processes any image shared to LUCY (photo, screenshot, whiteboard, receipt,
 * menu, document) with a remote vision model:
 *   - Claude (Sonnet) when the user's remote model is Claude — best at handwriting.
 *   - OpenAI gpt-4o at HIGH detail otherwise.
 * There is NO on-device OCR here; reading an image needs remote intelligence enabled.
 *
 * Storage policy: ONLY the extracted memory text is stored. The original image
 * is NEVER saved — deleted immediately after extraction.
 */

// SDK 56 deprecated these on the main entry; the legacy module keeps them stable.
import { readAsStringAsync, EncodingType, deleteAsync } from 'expo-file-system/legacy';
import { enqueueTranscript } from './extract';
import { resolveRemoteAvailability } from '../ai/provider';
import { promptAI } from '../ai/openai';
import { isAiCallCapReached, recordAiCall } from '../ai/rateLimit';
import { getDatabase } from '../db';

export type LensCategory = 'receipt' | 'whiteboard' | 'screenshot' | 'document' | 'photo' | 'menu' | 'other';

export interface LensResult {
  memoryText: string;
  category: LensCategory;
  confidence: 'high' | 'low';
}

const LENS_SYSTEM = `You are LUCY, extracting a memory from an image the user shared.
Your job: capture what is in the image as a searchable memory the user can query later.

CRITICAL — TRANSCRIPTION ACCURACY (this matters most):
- Transcribe ALL visible text EXACTLY as written, letter for letter — including handwriting.
- Do NOT autocorrect, normalize, expand, translate, or "fix" anything. Preserve unusual spellings,
  acronyms, product names, and technical terms verbatim (e.g. write "AD groups" not "AB groups";
  "Tidal" not "TID"; "bugs" not "bags"). Common words are often domain terms — never swap them.
- If a word is genuinely unclear, give your single best LITERAL reading of the strokes; never
  substitute a more familiar word, and never invent items that aren't written.
- Preserve the original order and line breaks of any list.

Then:
1. Receipt → list items + total. Whiteboard/note → capture every line of writing.
2. Screenshot → name the app/page and the key information.
3. Photo → describe the scene, any people/location, and any visible text (verbatim).
4. Identify the category: receipt | whiteboard | screenshot | document | photo | menu | other.
5. Plain text, no markdown.
Return JSON only: {"category":"receipt|whiteboard|screenshot|document|photo|menu|other","memory":"..."}`;

/** Process an image URI → extract a memory text → enqueue as a capture → delete image. */
export async function processImageToMemory(
  uri: string,
  originalName?: string | null,
): Promise<LensResult | null> {
  let base64: string | null = null;
  try {
    base64 = await readAsStringAsync(uri, { encoding: EncodingType.Base64 });
  } catch {
    return null;
  }

  let result: LensResult | null = null;

  try {
    const db = await getDatabase();
    const { available, openAIKey } = await resolveRemoteAvailability();
    const preferred = (await import('../ai/modelPreference')).getPreferredModel(require('../config').config.openAIModel);
    const useClaude = preferred.startsWith('claude-');
    // JPEG by default; PNG screenshots must be tagged correctly or the model rejects the bytes.
    const mediaType = /\.png$/i.test(uri) || /\.png$/i.test(originalName ?? '') ? 'image/png' : 'image/jpeg';

    if (available && !await isAiCallCapReached(db)) {
      let content = '';
      if (useClaude) {
        // Claude (Sonnet) reads handwriting/whiteboards far better than gpt-4o-mini.
        const { promptClaudeVision } = await import('../ai/claude');
        content = await promptClaudeVision(`${LENS_SYSTEM}\n\nFilename hint: ${originalName ?? 'unknown'}`, base64, mediaType);
        void recordAiCall(db);
      } else if (openAIKey) {
        // OpenAI path: use full gpt-4o (not mini) at HIGH detail — low detail downscales to ~512px
        // and shreds handwriting. High detail keeps the strokes legible.
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${openAIKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'gpt-4o',
            max_tokens: 700,
            messages: [{
              role: 'user',
              content: [
                { type: 'text', text: `${LENS_SYSTEM}\n\nFilename hint: ${originalName ?? 'unknown'}` },
                { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64}`, detail: 'high' } },
              ],
            }],
          }),
        });
        void recordAiCall(db);
        if (response.ok) {
          const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
          content = json.choices?.[0]?.message?.content ?? '';
        }
      }
      const start = content.indexOf('{');
      const end = content.lastIndexOf('}');
      if (start !== -1 && end !== -1) {
        const parsed = JSON.parse(content.slice(start, end + 1)) as { category?: string; memory?: string };
        if (parsed.memory) {
          result = {
            memoryText: parsed.memory,
            category: (parsed.category as LensCategory) ?? 'other',
            confidence: 'high',
          };
        }
      }
    }
  } catch { /* fall through to text-only path */ }

  // Fallback: minimal memory from filename + "image shared"
  if (!result) {
    const hint = originalName
      ? `Image shared: ${originalName}`
      : 'Image shared — no description available (enable Remote Intelligence for visual memory)';
    result = { memoryText: hint, category: 'other', confidence: 'low' };
  }

  // Enqueue as a capture — source 'voice' (closest existing source; a dedicated
  // 'photo' source will be added when CaptureSource is extended)
  if (result.memoryText) {
    await enqueueTranscript(
      `[Photo: ${result.category}] ${result.memoryText}`,
      'text',
      false,
    );
  }

  // PRIVACY: delete the original image immediately — never stored
  deleteAsync(uri, { idempotent: true }).catch(() => {});

  return result;
}
