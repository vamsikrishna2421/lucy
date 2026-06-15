/**
 * Mic coordinator — there is exactly ONE on-device speech recognizer
 * (ExpoSpeechRecognitionModule), so Listen mode, the conversation loop, and the "Hey Lucy" wake-word
 * listener must not run it at once. This is a tiny reference-counted "mic busy" flag:
 *
 * - Listen mode (PassiveListener) and the conversation loop ACQUIRE the mic while active.
 * - The wake-word listener is the low-priority background owner: it subscribes here and PAUSES
 *   itself whenever the mic is busy, then RESUMES when it's free again.
 *
 * Keeping this as a flag (not a queue) is enough because the foreground modes are user-initiated and
 * mutually exclusive; the wake word simply yields to them.
 */
type Owner = 'listen' | 'conversation' | string;

let owners = new Set<Owner>();
const listeners = new Set<(busy: boolean) => void>();

function emit(): void {
  const busy = owners.size > 0;
  for (const l of listeners) l(busy);
}

/** Mark the recognizer as in use by a foreground owner. Idempotent per owner. */
export function acquireMic(owner: Owner): void {
  const was = owners.size > 0;
  owners.add(owner);
  if (!was && owners.size > 0) emit();
}

/** Release a foreground owner. When none remain, the wake word may resume. */
export function releaseMic(owner: Owner): void {
  if (!owners.has(owner)) return;
  owners.delete(owner);
  if (owners.size === 0) emit();
}

export function isMicBusy(): boolean {
  return owners.size > 0;
}

/** Subscribe to busy transitions (the wake-word listener uses this to pause/resume). */
export function onMicBusyChange(fn: (busy: boolean) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
