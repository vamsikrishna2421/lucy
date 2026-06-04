import { getRemoteOpenAIKey } from '../ai/remoteAccess';
import { File as FSFile } from 'expo-file-system';

export async function transcribeAudioFile(uri: string): Promise<string | null> {
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

  console.log(`[Whisper] Sending ${uri.slice(-40)} to Whisper API…`);

  try {
    // SDK 56: use expo-file-system File class (implements Blob) instead of
    // the {uri, type, name} object pattern which throws "Unsupported FormDataPart"
    const audioFile = new FSFile(uri);
    const form = new FormData();
    form.append('file', audioFile as unknown as Blob, 'recording.m4a');
    form.append('model', 'whisper-1');

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
