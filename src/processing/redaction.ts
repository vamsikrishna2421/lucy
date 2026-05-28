export interface RemoteRedaction {
  placeholder: string;
  localValue: string;
  kind: 'credential' | 'card';
}

export interface RedactedRemoteText {
  text: string;
  replacements: RemoteRedaction[];
}

const labeledCredentials = [
  /\b(?:wifi\s+)?password\s*(?:is|=|:)\s*([^\s,;.!?]+)/gi,
  /\bpasscode\s*(?:is|=|:)\s*([^\s,;.!?]+)/gi,
  /\bpin\s*(?:is|=|:)\s*(\d{3,12})\b/gi,
  /\botp\s*(?:is|=|:)\s*(\d{4,12})\b/gi,
  /\baccount number\s*(?:is|=|:)\s*([A-Za-z0-9 -]{5,32})/gi,
];

const paymentCard = /\b(?:\d[ -]*?){13,19}\b/g;

export function redactForRemote(text: string): RedactedRemoteText {
  const replacements: RemoteRedaction[] = [];
  let redacted = text;

  labeledCredentials.forEach((pattern) => {
    redacted = redacted.replace(pattern, (matched: string, localValue: string) => {
      const placeholder = `[CREDENTIAL_${replacements.length + 1}]`;
      replacements.push({ placeholder, localValue: localValue.trim(), kind: 'credential' });
      return matched.replace(localValue, placeholder);
    });
  });

  redacted = redacted.replace(paymentCard, (localValue: string) => {
    const placeholder = `[CARD_${replacements.length + 1}]`;
    replacements.push({ placeholder, localValue, kind: 'card' });
    return placeholder;
  });

  return { text: redacted, replacements };
}

export function applyRemoteRedactionMap(text: string, replacements: RemoteRedaction[]): string {
  return replacements.reduce(
    (result, replacement) => result.replaceAll(replacement.localValue, replacement.placeholder),
    text,
  );
}

export function restoreRemoteRedactions(text: string, replacements: RemoteRedaction[]): string {
  return replacements.reduce(
    (result, replacement) => result.replaceAll(replacement.placeholder, replacement.localValue),
    text,
  );
}
