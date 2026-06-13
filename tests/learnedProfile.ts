/**
 * Learned Profile — pure-logic tests (no expo). Run: `tsx tests/learnedProfile.ts`.
 */
import assert from 'node:assert';
import { normalizeStatement } from '../src/db/learnedProfile';

// Dedup key ignores case, punctuation, and extra whitespace.
assert.equal(normalizeStatement('Prefers terse summaries.'), 'prefers terse summaries');
assert.equal(
  normalizeStatement('  Prefers   TERSE, summaries!! '),
  normalizeStatement('prefers terse summaries'),
  'case/punctuation/whitespace variants normalize to the same key',
);
assert.notEqual(
  normalizeStatement('defers gym tasks'),
  normalizeStatement('defers work tasks'),
  'genuinely different statements stay distinct',
);
assert.equal(normalizeStatement('!!!'), '', 'punctuation-only normalizes to empty (rejected by upsert)');

console.log('learnedProfile.ts: all assertions passed ✓');
