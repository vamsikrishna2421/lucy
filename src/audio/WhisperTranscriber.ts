import { getRemoteOpenAIKey } from '../ai/remoteAccess';

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

  const form = new FormData();
  form.append('file', { uri, type: 'audio/m4a', name: 'recording.m4a' } as unknown as Blob);
  form.append('model', 'whisper-1');

  try {
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => '(unreadable)');
      console.error(`[Whisper] API error ${response.status}: ${errText.slice(0, 200)}`);
      // Return the error so the caller can surface it in the session card
      throw new Error(`Whisper API ${response.status}: ${errText.slice(0, 100)}`);
    }
    const result = (await response.json()) as { text?: string };
    console.log(`[Whisper] Got text: "${(result.text ?? '').slice(0, 60)}"`);
    return result.text?.trim() || null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[Whisper] fetch error:', msg);
    throw e; // re-throw so PassiveListener can include the real error in the session card
  }
}
