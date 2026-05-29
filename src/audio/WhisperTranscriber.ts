import { getRemoteOpenAIKey } from '../ai/remoteAccess';

export async function transcribeAudioFile(uri: string): Promise<string | null> {
  let apiKey: string | null = null;
  try {
    apiKey = await getRemoteOpenAIKey();
  } catch {
    return null;
  }
  if (!apiKey) return null;

  const form = new FormData();
  form.append('file', { uri, type: 'audio/mp4', name: 'passive.m4a' } as unknown as Blob);
  form.append('model', 'whisper-1');
  // No language hint — let Whisper auto-detect (handles Telugu, Tanglish, mixed)

  try {
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!response.ok) return null;
    const result = (await response.json()) as { text?: string };
    return result.text?.trim() || null;
  } catch {
    return null;
  }
}
