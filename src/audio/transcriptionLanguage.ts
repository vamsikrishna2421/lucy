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
