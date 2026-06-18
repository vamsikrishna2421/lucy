/**
 * Privacy Shield round-trip tests. Pure module (no expo), runs via `tsx tests/shield.ts`.
 */
import assert from 'node:assert';
import { findProtectedValues, shieldText, restoreText } from '../src/processing/sensitiveShield';

// --- Passwords / secrets ---
{
  const text = 'My wifi password is hunter2 and the PIN is 4821.';
  const { redacted, map } = shieldText(text, []);
  assert.ok(redacted.includes('[SECRET_1]'), 'password should be tokenized');
  assert.ok(!redacted.includes('hunter2'), 'raw password must not be in redacted text');
  assert.ok(!redacted.includes('4821'), 'raw PIN must not be in redacted text');
  assert.equal(restoreText(redacted, map), text, 'restore must reproduce the original exactly');
}

// "change my password" has no value → nothing grabbed.
{
  const { redacted } = shieldText('I need to change my password tomorrow.', []);
  assert.ok(!redacted.includes('[SECRET'), 'no value present → no secret token');
}

// --- People names ---
{
  // Contact name
  const { redacted, map } = shieldText('Met Sam at 3pm to discuss the plan.', ['Sam']);
  assert.ok(redacted.includes('[PERSON_1]'), 'contact name should be tokenized');
  assert.ok(!/\bSam\b/.test(redacted), 'raw name must not be in redacted text');
  assert.ok(restoreText(redacted, map).includes('Sam'), 'restore brings the name back');
}
{
  // Same name twice → one token, both occurrences replaced.
  const { redacted, map } = shieldText('Sam called. I will call Sam back.', ['Sam']);
  const personTokens = map.filter((m) => m.kind === 'person');
  assert.equal(personTokens.length, 1, 'one unique person → one token');
  assert.ok(!/\bSam\b/.test(redacted), 'all occurrences replaced');
}
{
  // Cue-based detection for an unknown (non-contact) name.
  const found = findProtectedValues('I met Priya near the office.', []);
  assert.ok(found.some((f) => f.kind === 'person' && f.value === 'Priya'), 'cue + gazetteer catches Priya');
}
{
  // Full name (first + surname) caught as a unit, even after a sentence-opening cue word.
  const found = findProtectedValues('Meet Jan Pyda tomorrow.', []);
  assert.ok(found.some((f) => f.kind === 'person' && f.value === 'Jan Pyda'), 'full name "Jan Pyda" is protected');
  assert.ok(!found.some((f) => f.value === 'Meet' || f.value === 'Tomorrow'), 'cue/stopwords are not names');
}
{
  // Surname not absorbed past a stopword.
  const found = findProtectedValues('Call Sam Monday.', ['Sam']);
  assert.ok(found.some((f) => f.value === 'Sam'), 'Sam protected');
  assert.ok(!found.some((f) => f.value.includes('Monday')), 'weekday not absorbed into the name');
}
{
  // Conjoined names: a name after "and" is caught even with no cue of its own.
  const found = findProtectedValues('Told Priya and Raghavendra the plan.', []);
  assert.ok(found.some((f) => f.value === 'Priya'), 'Priya (cue + gazetteer)');
  assert.ok(found.some((f) => f.value === 'Raghavendra'), 'Raghavendra caught via "and" conjunction');
}
{
  // Comma + and list.
  const found = findProtectedValues('Met Sam, Priya and Kavya today.', []);
  ['Sam', 'Priya', 'Kavya'].forEach((n) => assert.ok(found.some((f) => f.value === n), `${n} in the list is caught`));
}
{
  // "and" must not drag in a non-name after a person.
  const found = findProtectedValues('Met Sam and London was great.', []);
  assert.ok(found.some((f) => f.value === 'Sam'), 'Sam caught');
  assert.ok(!found.some((f) => f.value.toLowerCase() === 'london'), 'place after "and" is not a name');
}

// --- No over-redaction of capitalized non-names ---
{
  const found = findProtectedValues('On Monday I flew to London for a meeting.', []);
  assert.ok(!found.some((f) => f.value.toLowerCase() === 'monday'), 'weekday is not a person');
  assert.ok(!found.some((f) => f.value.toLowerCase() === 'london'), 'place is not a person');
}

// --- Mixed ---
{
  const text = 'Texted Sam that the account number is AB12345 today.';
  const { redacted, map } = shieldText(text, ['Sam']);
  assert.ok(redacted.includes('[PERSON_1]') && redacted.includes('[SECRET_1]'), 'both kinds tokenized');
  assert.equal(restoreText(redacted, map), text, 'mixed round-trip restores exactly');
}

// --- Tolerant restore (LLMs mangle tokens — a brittle exact match leaks "[PERSON_1]") ---
{
  const { map } = shieldText('wifi password is Hunter2 and I met Srinivas today', []);
  assert.ok(restoreText('met PERSON_1 today', map).includes('Srinivas'), 'no-bracket token restores');
  assert.ok(restoreText('met [PERSON 1] today', map).includes('Srinivas'), 'space-variant token restores');
  assert.ok(restoreText('code [secret-1]', map).includes('Hunter2'), 'dash + lowercase token restores');
  assert.ok(restoreText('met person_1', map).includes('Srinivas'), 'lowercase no-bracket token restores');
  assert.ok(!/PERSON|SECRET/i.test(restoreText('met [Person_1], pw SECRET_1', map)), 'no raw token survives');
  // Hallucinated token we never issued must not leak the raw token to the user.
  const hall = restoreText('met [PERSON_9]', map);
  assert.ok(!/PERSON_9/i.test(hall) && hall.includes('them'), 'unknown person token → "them", not raw');
  assert.equal(restoreText('met [PERSON_1]', []), 'met [PERSON_1]', 'empty map is a pass-through');
}
{
  // PERSON_1 must not clobber inside PERSON_11 (greedy digit run).
  const m2 = [
    { token: '[PERSON_1]', value: 'Sam', kind: 'person' as const },
    { token: '[PERSON_11]', value: 'Alex', kind: 'person' as const },
  ];
  assert.equal(restoreText('a [PERSON_11] b [PERSON_1]', m2), 'a Alex b Sam', 'PERSON_11 not clobbered by PERSON_1');
}

console.log('shield.ts: all assertions passed ✓');
