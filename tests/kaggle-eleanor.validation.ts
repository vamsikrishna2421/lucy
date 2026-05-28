import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const rawDirectory = path.resolve(process.cwd(), 'benchmarks', 'kaggle-eleanor', 'raw');
const dailyPath = path.join(
  rawDirectory,
  'Eleanor_Vance_Daily_Records_Dec-1-2020_to_Nov-30-2024.json',
);
const injectionPath = path.join(rawDirectory, 'Eleanor_Vance_manual_injections_info.json');

assert.ok(
  fs.existsSync(dailyPath) && fs.existsSync(injectionPath),
  'Extract the local Eleanor JSON files into benchmarks/kaggle-eleanor/raw before running this check.',
);

type DailyCorpus = {
  GENERAL_PROFILE: Record<string, unknown>;
  DAILY_RECORDS: Record<string, string>;
};

type InjectionProbe = {
  date: string;
  injected_note: string;
  response_expected_content: string;
  testing_prompt: string;
};

const daily = JSON.parse(fs.readFileSync(dailyPath, 'utf8')) as DailyCorpus;
const probes = JSON.parse(fs.readFileSync(injectionPath, 'utf8')) as Record<string, InjectionProbe>;
const recordEntries = Object.entries(daily.DAILY_RECORDS);
const dailyText = recordEntries.map(([, text]) => text).join('\n');
const probeText = JSON.stringify(probes);

assert.deepEqual(
  Object.keys(daily.GENERAL_PROFILE).sort(),
  ['age', 'details', 'name'],
  'Daily-record profile schema changed.',
);
assert.equal(recordEntries.length, 1460, 'Expected four years of daily records.');
assert.equal(recordEntries[0]?.[0], 'December 1, 2020', 'Unexpected first record date.');
assert.equal(recordEntries.at(-1)?.[0], 'November 30, 2024', 'Unexpected final record date.');

const requiredSections = ['Tasks for Today', 'Completed Yesterday', 'Journal Entry'];
requiredSections.forEach((section) => {
  const count = recordEntries.filter(([, text]) => text.includes(`**${section}:**`)).length;
  assert.equal(count, recordEntries.length, `Each daily record should contain ${section}.`);
});

assert.equal(Object.keys(probes).length, 50, 'Expected fifty injected-memory probes.');
Object.values(probes).forEach((probe) => {
  assert.deepEqual(
    Object.keys(probe).sort(),
    ['date', 'injected_note', 'response_expected_content', 'testing_prompt'],
    'Manual injection probe schema changed.',
  );
});

const protectedSignals = {
  credential: /password|passcode|\bpin\b|account number/i.test(`${dailyText}\n${probeText}`),
  health: /health|pain|anxiety|panic|allerg|medicat|doctor|physio|cholesterol|mercury/i.test(
    `${dailyText}\n${probeText}`,
  ),
  relationship: /husband|wife|relationship|family|children|daughter|\bson\b/i.test(dailyText),
};

assert.equal(protectedSignals.credential, true, 'Credential-like content should enforce local-only use.');
assert.equal(protectedSignals.health, true, 'Health content should enforce local-only use.');

console.log(
  `Eleanor benchmark ready locally: ${recordEntries.length} daily entries, ${Object.keys(probes).length} probes; protected-content lane enforced (credential=${protectedSignals.credential}, health=${protectedSignals.health}, relationship=${protectedSignals.relationship}).`,
);
