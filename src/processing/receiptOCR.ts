/**
 * LUCY Receipt OCR
 *
 * User takes a photo of a receipt → LUCY extracts amount, merchant, category.
 * Uses OpenAI Vision API when remote AI is enabled.
 * Falls back to on-device pattern matching for common receipt formats.
 */

import { getRemoteAccessState, getRemoteOpenAIKey } from '../ai/remoteAccess';

export interface ExtractedReceipt {
  amount: string | null;
  merchant: string | null;
  category: 'food' | 'transport' | 'shopping' | 'entertainment' | 'other';
  date: string | null;
  rawText: string;
}

async function imageToBase64(uri: string): Promise<string> {
  const { readAsBase64: readAsBase64Async } = await import('expo-file-system') as any;
  if (readAsBase64Async) {
    return readAsBase64Async(uri);
  }
  // Fallback: fetch the file and convert
  const response = await fetch(uri);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
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

export async function processReceiptImage(imageUri: string): Promise<ExtractedReceipt> {
  const remote = await getRemoteAccessState();
  if (remote.enabled && remote.hasKey) {
    try {
      const apiKey = await getRemoteOpenAIKey();
      if (apiKey) {
        // Use expo-file-system to read as base64
        const { readAsStringAsync, EncodingType } = await import('expo-file-system');
        const base64 = await readAsStringAsync(imageUri, { encoding: EncodingType.Base64 });
        const result = await extractWithVision(base64, apiKey);
        if (result) return result;
      }
    } catch { /* fall through */ }
  }
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
