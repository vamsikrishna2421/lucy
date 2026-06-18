/**
 * LUCY Receipt OCR
 *
 * User takes a photo of a receipt → LUCY extracts amount, merchant, category.
 * Uses OpenAI Vision API when remote AI is enabled.
 * Falls back to on-device pattern matching for common receipt formats.
 */

import { getRemoteOpenAIKey } from '../ai/remoteAccess';

export interface ExtractedReceipt {
  amount: string | null;
  merchant: string | null;
  category: 'food' | 'transport' | 'shopping' | 'entertainment' | 'other';
  date: string | null;
  rawText: string;
}

async function imageToBase64(uri: string): Promise<string> {
  // SDK 56: read base64 via the legacy file-system module (stable API).
  const { readAsStringAsync, EncodingType } = await import('expo-file-system/legacy');
  return readAsStringAsync(uri, { encoding: EncodingType.Base64 });
}

async function extractWithVision(base64Image: string, apiKey: string): Promise<ExtractedReceipt | null> {
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Extract from this receipt: total amount (just the number), merchant/store name, and best category (food/transport/shopping/entertainment/other). Reply with JSON only: {"amount":"","merchant":"","category":"","date":""}. Use null for missing fields.',
            },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}`, detail: 'low' } },
          ],
        }],
      }),
    });

    if (!response.ok) return null;
    const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = json.choices?.[0]?.message?.content ?? '';
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start === -1) return null;

    const parsed = JSON.parse(content.slice(start, end + 1)) as { amount?: string; merchant?: string; category?: string; date?: string };
    return {
      amount: parsed.amount ?? null,
      merchant: parsed.merchant ?? null,
      category: (['food','transport','shopping','entertainment'].includes(parsed.category ?? '') ? parsed.category : 'other') as ExtractedReceipt['category'],
      date: parsed.date ?? null,
      rawText: content,
    };
  } catch {
    return null;
  }
}

function extractWithPatterns(imageUri: string): ExtractedReceipt {
  // Basic fallback — return empty so user can fill in manually
  return { amount: null, merchant: null, category: 'other', date: null, rawText: '' };
}

const RECEIPT_PROMPT = 'Extract from this receipt: total amount (just the number), merchant/store name, and best category (food/transport/shopping/entertainment/other). Reply with JSON only: {"amount":"","merchant":"","category":"","date":""}. Use null for missing fields.';

function parseReceiptJson(content: string): ExtractedReceipt | null {
  const start = content.indexOf('{'); const end = content.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    const parsed = JSON.parse(content.slice(start, end + 1)) as { amount?: string; merchant?: string; category?: string; date?: string };
    return {
      amount: parsed.amount ?? null,
      merchant: parsed.merchant ?? null,
      category: (['food', 'transport', 'shopping', 'entertainment'].includes(parsed.category ?? '') ? parsed.category : 'other') as ExtractedReceipt['category'],
      date: parsed.date ?? null,
      rawText: content,
    };
  } catch { return null; }
}

export async function processReceiptImage(imageUri: string): Promise<ExtractedReceipt> {
  try {
    const { getModelKeyStatus } = await import('../ai/provider');
    const status = await getModelKeyStatus();
    if (status.remote && status.keyPresent) {
      const base64 = await imageToBase64(imageUri);
      if (status.model.startsWith('claude-')) {
        // Use Claude vision when a Claude model is selected (never silently use gpt).
        const { promptClaudeVision } = await import('../ai/claude');
        const out = await promptClaudeVision(RECEIPT_PROMPT, base64, /\.png$/i.test(imageUri) ? 'image/png' : 'image/jpeg', status.model);
        const r = parseReceiptJson(out);
        if (r) return r;
      } else {
        const apiKey = await getRemoteOpenAIKey();
        if (apiKey) { const r = await extractWithVision(base64, apiKey); if (r) return r; }
      }
    }
  } catch { /* fall through to on-device patterns */ }
  return extractWithPatterns(imageUri);
}

export function receiptToCapture(receipt: ExtractedReceipt): string {
  const parts: string[] = [];
  if (receipt.merchant) parts.push(`Paid at ${receipt.merchant}`);
  if (receipt.amount) parts.push(`amount ${receipt.amount}`);
  if (receipt.category) parts.push(`category ${receipt.category}`);
  if (receipt.date) parts.push(`on ${receipt.date}`);
  return parts.length > 0 ? parts.join(', ') : 'Receipt scanned — please add details';
}
