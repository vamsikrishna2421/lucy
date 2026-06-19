/* Pure tests for the commitment/deadline extractor. Run: npx tsx tests/commitments.ts */
import { extractCommitments, atRiskCommitments, resolveCommitmentDue } from '../src/processing/commitments';
import { normalizeExtraction } from '../src/processing/schema';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean) { if (cond) { pass++; } else { fail++; console.error('FAIL:', name); } }

const now = Date.now();

// "I owe" detection + counterparty + deadline.
const a = extractCommitments("I'll send the Alation lineage doc to Raghavendra by Thursday.", now);
ok('detects an I-owe commitment', a.length === 1 && a[0].direction === 'i-owe');
ok('captures counterparty', a[0]?.counterparty === 'Raghavendra');
ok('action mentions send', /send/i.test(a[0]?.action ?? ''));
ok('resolves a deadline', !!a[0]?.dueISO);

// "need to" variant, no person.
const b = extractCommitments('I need to submit the report by tomorrow', now);
ok('detects need-to as i-owe', b.length === 1 && b[0].direction === 'i-owe' && !!b[0].dueISO);
ok('no counterparty when none named', b[0]?.counterparty === null);

// Owed-to-me: someone will send the user something.
const c = extractCommitments('Priya will send me the pipeline numbers by Friday.', now);
ok('detects owed-to-me', c.length === 1 && c[0].direction === 'owed-to-me' && c[0].counterparty === 'Priya');

// "waiting on X"
const d = extractCommitments('Still waiting on Monisha for the signed lease.', now);
ok('detects waiting-on as owed-to-me', d.length === 1 && d[0].direction === 'owed-to-me' && d[0].counterparty === 'Monisha');

// Non-commitment text yields nothing.
ok('plain note yields no commitments', extractCommitments('Had a coffee and read the news.', now).length === 0);
ok('a question is not a commitment', extractCommitments('Did I send the report?', now).length === 0);

// Multiple sentences → multiple commitments.
const multi = extractCommitments("I'll email the deck to Sam by Monday. I owe Dana the invoice.", now);
ok('extracts multiple', multi.length === 2);

// atRisk: a due-tomorrow commitment is at risk within 48h; a far one is not.
const soon = extractCommitments('I will pay the rent by tomorrow', now);
ok('tomorrow commitment is at risk', atRiskCommitments(soon, now).length === 1);
const far = extractCommitments('I will send the slides by Friday', new Date('2026-06-15T09:00:00Z').getTime());
ok('far commitment not at risk in 48h', atRiskCommitments(far, new Date('2026-06-15T09:00:00Z').getTime()).length === 0);

// ── Phase 2: LLM-typed commitments ──────────────────────────────────────────────
// resolveCommitmentDue handles ISO, natural language, and empty.
ok('resolveCommitmentDue parses ISO', resolveCommitmentDue('2026-06-22', now) === new Date('2026-06-22').toISOString());
ok('resolveCommitmentDue parses natural language', !!resolveCommitmentDue('Thursday', now));
ok('resolveCommitmentDue empty → null', resolveCommitmentDue('', now) === null && resolveCommitmentDue(null, now) === null);

// normalizeExtraction parses an LLM commitments array defensively.
const ext = normalizeExtraction({
  commitments: [
    { action: 'send the deck', counterparty: 'Raghavendra', due: 'Thursday', direction: 'i-owe' },
    { action: 'pay me back', counterparty: 'Sam', due: '', direction: 'owed-to-me' },
    { action: '', counterparty: 'X', due: '', direction: 'i-owe' }, // dropped: empty action
    { action: 'do thing', counterparty: '', due: '', direction: 'bogus' }, // direction defaults to i-owe
  ],
});
ok('schema keeps valid commitments, drops empty-action', ext.commitments.length === 3);
ok('schema maps counterparty + direction', ext.commitments[0].counterparty === 'Raghavendra' && ext.commitments[0].direction === 'i-owe');
ok('schema empty counterparty → null', ext.commitments[2].counterparty === null);
ok('schema bad direction → i-owe', ext.commitments[2].direction === 'i-owe');
ok('schema missing commitments → []', normalizeExtraction({}).commitments.length === 0);

console.log(`\ncommitments: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
