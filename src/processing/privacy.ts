import type { ExtractionResult, PrivacyLevel } from '../types/extraction';

interface PrivacyClassification {
  level: PrivacyLevel;
  reason: string;
}

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

/**
 * Captures are no longer auto-classified as private. Passwords and people names are
 * protected by the on-device Privacy Shield (tokenized for remote calls — see
 * sensitiveShield.ts), not by withholding the whole capture. Startup ideas / health /
 * relationships are NOT auto-protected. Users can still manually mark a capture private.
 */
export function classifyPrivacy(_text: string): PrivacyClassification {
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
  // Only an explicit user "mark private" forces a fully-local capture now. Ideas are
  // no longer private by default.
  if (preflight.level === 'private') {
    return {
      ...extraction,
      privacy_level: 'private',
      privacy_reason: preflight.reason,
    };
  }
  return extraction;
}
