const WHISPER_LANGUAGE_HINTS = new Set([
  'af', 'ar', 'hy', 'az', 'be', 'bs', 'bg', 'ca', 'zh', 'hr', 'cs', 'da',
  'nl', 'en', 'et', 'fi', 'fr', 'gl', 'de', 'el', 'he', 'hi', 'hu', 'is',
  'id', 'it', 'ja', 'kn', 'kk', 'ko', 'lv', 'lt', 'mk', 'ms', 'mr', 'mi',
  'ne', 'no', 'fa', 'pl', 'pt', 'ro', 'ru', 'sr', 'sk', 'sl', 'es', 'sw',
  'sv', 'tl', 'ta', 'th', 'tr', 'uk', 'ur', 'vi', 'cy',
]);

/**
 * A language hint is safe only when the user selected one language and the
 * Whisper API documents that language. Mixed-language speech needs detection.
 */
export function getTranscriptionLanguageHint(languages: string[]): string | null {
  const selected = [...new Set(languages.map((language) => language.trim().toLowerCase()).filter(Boolean))];
  if (selected.length !== 1) return null;

  const [language] = selected;
  return WHISPER_LANGUAGE_HINTS.has(language) ? language : null;
}

const DEVICE_LOCALES: Record<string, string> = {
  en: 'en-US',
  te: 'te-IN',
  hi: 'hi-IN',
  ta: 'ta-IN',
  kn: 'kn-IN',
  ml: 'ml-IN',
  mr: 'mr-IN',
  bn: 'bn-IN',
  gu: 'gu-IN',
  pa: 'pa-IN',
  ur: 'ur-IN',
};

export function getDeviceSpeechLocale(languages: string[]): string {
  const selected = [...new Set(languages.map((language) => language.trim().toLowerCase()).filter(Boolean))];
  const primary = selected.find((language) => language !== 'en') ?? selected[0] ?? 'en';
  return DEVICE_LOCALES[primary] ?? `${primary}-IN`;
}

export function shouldRetryWithoutLanguageHint(
  status: number,
  responseBody: string,
  languageHint: string | null,
): boolean {
  if (!languageHint || status !== 400) return false;
  const message = responseBody.toLowerCase();
  return message.includes('language') && message.includes('not supported');
}
