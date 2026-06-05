import { File as FSFile } from 'expo-file-system';
import { getRemoteOpenAIKey } from '../ai/remoteAccess';
import { shouldRetryWithoutLanguageHint } from './transcriptionLanguage';

/**
 * Transcribes an audio file using OpenAI Whisper.
 *
 * @param uri       Path to the audio file (M4A)
 * @param language  Documented ISO-639 language code for a single expected language.
 *                  Null = auto-detect, which is required for mixed-language speech.
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
    const sendRequest = (requestLanguage: string | null) => {
      const audioFile = new FSFile(uri);
      const form = new FormData();
      form.append('file', audioFile as unknown as Blob, 'recording.m4a');
      form.append('model', 'whisper-1');
      if (requestLanguage) form.append('language', requestLanguage);
      return fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });
    };

    let response = await sendRequest(langHint);
    if (!response.ok) {
      let errText = await response.text().catch(() => '(unreadable)');
      if (shouldRetryWithoutLanguageHint(response.status, errText, langHint)) {
        console.warn(`[Whisper] Language ${langHint} was rejected; retrying with auto-detect`);
        response = await sendRequest(null);
        if (response.ok) {
          const result = (await response.json()) as { text?: string };
          console.log(`[Whisper] Got text after auto-detect retry: "${(result.text ?? '').slice(0, 60)}"`);
          return result.text?.trim() || null;
        }
        errText = await response.text().catch(() => '(unreadable)');
      }
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
