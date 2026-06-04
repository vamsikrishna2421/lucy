import { File as FSFile } from 'expo-file-system';
import { getRemoteOpenAIKey } from '../ai/remoteAccess';

/**
 * Transcribes an audio file using OpenAI Whisper.
 *
 * @param uri       Path to the audio file (M4A)
 * @param language  ISO-639-1 code for the expected primary language (e.g. 'te' for Telugu).
 *                  Null = auto-detect (good for English-only; less reliable for mixed speech).
 */
export async function transcribeAudioFile(uri: string, language?: string | null): Promise<string | null> {
  let apiKey: string | null = null;
  try {
    apiKey = await getRemoteOpenAIKey();
  } catch (e) {
    console.error('[Whisper] getRemoteOpenAIKey error:', e);
    return null;
  }
  if (!apiKey) {
    console.warn('[Whisper] No OpenAI key stored');
    return null;
  }

  const langHint = language?.trim() || null;
  console.log(`[Whisper] Transcribing ${uri.slice(-40)} lang=${langHint ?? 'auto'}…`);

  try {
    const audioFile = new FSFile(uri);
    const form = new FormData();
    form.append('file', audioFile as unknown as Blob, 'recording.m4a');
    form.append('model', 'whisper-1');
    if (langHint) {
      // Providing a language hint skips Whisper's auto-detect step, reducing
      // mis-identification (e.g. Telugu being guessed as Hindi).
      form.append('language', langHint);
    }

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => '(unreadable)');
      console.error(`[Whisper] API error ${response.status}: ${errText.slice(0, 200)}`);
      throw new Error(`Whisper API ${response.status}: ${errText.slice(0, 100)}`);
    }
    const result = (await response.json()) as { text?: string };
    console.log(`[Whisper] Got text: "${(result.text ?? '').slice(0, 60)}"`);
    return result.text?.trim() || null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[Whisper] error:', msg);
    throw e;
  }
}
