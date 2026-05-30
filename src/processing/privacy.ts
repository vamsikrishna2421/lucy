import type { ExtractionResult, PrivacyLevel } from '../types/extraction';

interface PrivacyClassification {
  level: PrivacyLevel;
  reason: string;
}

const sensitiveSignals: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern:
      /\b(password|passcode|pin|otp|one[- ]time password|cvv|routing number|account number|ssn|social security)\b/i,
    reason: 'Possible credential or financial identifier',
  },
  {
    pattern:
      /\b(diagnos(?:is|ed)|prescription|medication|therapy|medical|doctor said|health condition|hospital)\b/i,
    reason: 'Possible personal health information',
  },
  {
    pattern:
      /\b(startup|business plan|product idea|patent|trade secret|confidential|nda|pitch deck|prototype idea)\b/i,
    reason: 'Possible confidential idea or business plan',
  },
  {
    pattern: /\b(breakup|divorce|affair|relationship issue|private conversation|intimate)\b/i,
    reason: 'Possible private relationship detail',
  },
  {
    pattern: /\b(?:\d[ -]*?){13,19}\b/,
    reason: 'Possible payment card number',
  },
];

const credentialSignals = [
  /\b(password|passcode|pin|otp|one[- ]time password|cvv|routing number|account number|ssn|social security)\b/i,
  /\b(?:\d[ -]*?){13,19}\b/,
];

export function containsCredentialSecret(text: string): boolean {
  return credentialSignals.some((signal) => signal.test(text));
}

/** Shows the actual text to the owner — they should see their own data.
 *  Only blocks sending to remote AI. Adds a lock prefix so user knows it's stored privately. */
export function protectedPreview(text: string): string {
  if (!text) return text;
  return containsCredentialSecret(text) ? `🔒 ${text}` : text;
}

export function protectCredentialExtraction(
  extraction: ExtractionResult,
  originalInput: string,
): ExtractionResult {
  if (!containsCredentialSecret(originalInput)) {
    return extraction;
  }
  // Keep extraction as-is for local display — just mark it private so it never leaves the device.
  // The actual content is stored and readable by the owner; remote AI never sees the raw value.
  const shouldCreateTask = /\b(change|update|reset|rotate|replace|need to|todo)\b/i.test(originalInput);
  const task = shouldCreateTask
    ? [{
        task: extraction.tasks[0]?.task ?? 'Update credential',
        category: 'other' as const,
        urgency: 'medium' as const,
        context: '',
      }]
    : extraction.tasks;

  return {
    ...extraction,
    privacy_level: 'private',
    tasks: task,
    tags: [...(extraction.tags ?? []), 'private-credential'],
  };
}

export function classifyPrivacy(text: string): PrivacyClassification {
  for (const signal of sensitiveSignals) {
    if (signal.pattern.test(text)) {
      return { level: 'private', reason: signal.reason };
    }
  }
  return { level: 'normal', reason: '' };
}

export function protectByUserChoice(text: string, markedPrivate: boolean): PrivacyClassification {
  const detected = classifyPrivacy(text);
  if (detected.level === 'private' || !markedPrivate) {
    return detected;
  }
  return { level: 'private', reason: 'Marked private by you' };
}

export function enforcePrivacy(
  extraction: ExtractionResult,
  preflight: PrivacyClassification,
): ExtractionResult {
  if (preflight.level === 'private') {
    return {
      ...extraction,
      privacy_level: 'private',
      privacy_reason: preflight.reason,
    };
  }

  if (extraction.ideas.length > 0) {
    return {
      ...extraction,
      privacy_level: 'private',
      privacy_reason: extraction.privacy_reason || 'Ideas are private by default',
    };
  }

  return extraction;
}
