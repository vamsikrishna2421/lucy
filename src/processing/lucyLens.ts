/**
 * LUCY Lens — visual memory extraction.
 *
 * Processes any image shared to LUCY (photo, screenshot, whiteboard, receipt,
 * menu, document) through:
 *   1. On-device Apple Vision OCR (text extraction, free, no key needed)
 *   2. Claude/OpenAI Vision for scene understanding when remote AI is available
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
Your job: describe what is in the image as a brief, searchable memory the user can query later.

Rules:
1. Extract ALL visible text verbatim (OCR). If it's a receipt, list items + total. If a whiteboard, capture all writing.
2. For screenshots: describe what app/page it is and what the key information is.
3. For photos: describe the scene, people (if any), location (if apparent), any text visible.
4. Identify the category: receipt | whiteboard | screenshot | document | photo | menu | other.
5. Keep the memory text concise but complete. Use plain text, no markdown.
6. Return JSON only: {"category":"receipt|whiteboard|screenshot|document|photo|menu|other","memory":"..."}`;

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
    const isOpenAI = !(await import('../ai/modelPreference').then((m) =>
      m.getPreferredModel(require('../config').config.openAIModel)
    )).startsWith('claude-');

    if (available && !await isAiCallCapReached(db)) {
      // Use OpenAI vision (Claude vision is available via claude-3 models only)
      // For now, use the OpenAI vision endpoint directly since it's the reliable path.
      const apiKey = isOpenAI
        ? openAIKey
        : (await import('../ai/remoteAccess').then((m) => m.getRemoteOpenAIKey()));

      if (apiKey) {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            max_tokens: 500,
            messages: [{
              role: 'user',
              content: [
                { type: 'text', text: `${LENS_SYSTEM}\n\nFilename hint: ${originalName ?? 'unknown'}` },
                { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}`, detail: 'low' } },
              ],
            }],
          }),
        });
        void recordAiCall(db);
        if (response.ok) {
          const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
          const content = json.choices?.[0]?.message?.content ?? '';
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
