import assert from 'node:assert/strict';
import { config } from '../src/config';
import { localReferenceTimestamp } from '../src/ai/prompts';
import { captureStatus, type CaptureRow } from '../src/db/captures';
import { formatConnectionNote, formatMarkdownNote } from '../src/processing/markdown';
import { extractExplicitEnglishFact } from '../src/processing/explicitEnglish';
import { isPaymentCompletionFollowUp } from '../src/processing/followUp';
import { normalizeMemoryLookupText, recognizesMemoryMapQuestion, recognizesMonthlySpendingQuestion, recognizesTodayPlanQuestion, requestedTaskContext } from '../src/processing/askIntent';
import { isInvalidDeadline, isInvalidPendingTask } from '../src/processing/artifactCleanup';
import { classifyPrivacy, enforcePrivacy, protectByUserChoice, protectCredentialExtraction, protectedPreview } from '../src/processing/privacy';
import { applyRemoteRedactionMap, redactForRemote, restoreRemoteRedactions } from '../src/processing/redaction';
import { confidenceFromEvidence, deriveKnowledgeProjection } from '../src/processing/organizer';
import { formatStructuredMemory } from '../src/processing/structuredMemory';
import { parseEnglishReminderTime, repairReminderTimes } from '../src/processing/reminderTime';
import { normalizeExtraction } from '../src/processing/schema';
import { shouldWriteMarkdown } from '../src/processing/vaultPolicy';
import type { ExtractionResult } from '../src/types/extraction';

function fixture(overrides: Partial<ExtractionResult>): ExtractionResult {
  return {
    title: 'Capture',
    summary: 'Summary',
    note_type: 'thought',
    detected_language: 'tanglish',
    privacy_level: 'normal',
    privacy_reason: '',
    projects: [],
    areas: [],
    people: [],
    tasks: [],
    expenses: [],
    ideas: [],
    places: [],
    interests: [],
    decisions: [],
    reminders: [],
    tags: [],
    suggested_folders: [],
    low_audio_warning: false,
    clarifications: [],
    memory_gaps: [],
    open_loops: [],
    follow_ups: [],
    ...overrides,
  };
}

const expenseSample = 'Ninna auto ki 180 pay chesa, expense lo add cheyyali.';
const todoSample = 'Repu morning 9 ki landlord ki call cheyyali, urgent ga remind cheyyi.';
const ideaSample = 'Na startup idea: local ga family memories organize chese private app build cheyyali.';

assert.equal(config.allowExternalAI, false, 'external AI must be opt-in by default');
assert.equal(protectByUserChoice('Met Sam for coffee.', true).level, 'private', 'user may explicitly protect a thought');
assert.match(protectByUserChoice('Met Sam for coffee.', true).reason, /Marked private/);
assert.match(protectByUserChoice('Password is ExampleOnly-4829.', false).reason, /credential/i);

const expense = enforcePrivacy(
  fixture({ expenses: [{ amount: '180', description: 'Auto fare', category: 'transport' }] }),
  classifyPrivacy(expenseSample),
);
assert.equal(expense.privacy_level, 'normal');
assert.equal(shouldWriteMarkdown(expense), true, 'normal expense should be eligible for markdown');
assert.match(formatMarkdownNote(expense, expenseSample, 'text', '2026-05-25T12:00:00.000Z'), /180 - Auto fare/);

const todo = enforcePrivacy(
  fixture({ tasks: [{ task: 'Call landlord', category: 'call', urgency: 'high', context: 'Tomorrow morning at 9' }] }),
  classifyPrivacy(todoSample),
);
assert.equal(todo.privacy_level, 'normal');
assert.equal(shouldWriteMarkdown(todo), true, 'normal todo should be eligible for markdown');
assert.match(formatMarkdownNote(todo, todoSample, 'text', '2026-05-25T12:00:00.000Z'), /Call landlord/);
const connectionNote = formatConnectionNote(
  fixture({
    title: 'Plan launch',
    projects: ['LUCY'],
    people: ['Sam'],
    interests: [{ topic: 'Memory design', strength: 'strong', evidence: 'Discussed daily organization' }],
    tasks: [{ task: 'Call landlord', category: 'call', urgency: 'high', context: '' }],
  }),
  '2026-05-25-2-Plan-launch.md',
  '2026-05-25T12:00:00.000Z',
);
assert.match(connectionNote, /\[\[Daily\/2026-05-25-2-Plan-launch\|Plan launch\]\]/);
assert.match(connectionNote, /\[\[Projects\/LUCY\/Workspace\|LUCY\]\]/);
assert.match(connectionNote, /\[\[People\/Sam\|Sam\]\]/);

const idea = enforcePrivacy(
  fixture({ ideas: [{ title: 'Private memory app', description: 'Organize family memories locally', type: 'startup' }] }),
  classifyPrivacy(ideaSample),
);
assert.equal(idea.privacy_level, 'private');
assert.match(idea.privacy_reason, /idea|business/i);
assert.equal(shouldWriteMarkdown(idea), false, 'ideas must never be eligible for markdown');

const ideaWithoutKeyword = enforcePrivacy(
  fixture({ ideas: [{ title: 'Unannounced concept', description: 'Keep private', type: 'creative' }] }),
  classifyPrivacy('Oka kottha concept vachindi.'),
);
assert.equal(ideaWithoutKeyword.privacy_level, 'private', 'extracted ideas default to private');
assert.equal(shouldWriteMarkdown(ideaWithoutKeyword), false);

const normalized = normalizeExtraction({
  ...fixture({}),
  detected_language: 'english|hindi|telugu|tanglish|mixed|other',
  tasks: [{ task: 'Create reminder', category: 'reminder', urgency: 'soon', context: '' }],
});
assert.equal(normalized.detected_language, 'english');
assert.equal(normalized.tasks[0].category, 'other', 'invalid local-model categories must be normalized');
assert.equal(normalized.tasks[0].urgency, 'low', 'invalid local-model urgency must be normalized');

const blankRows = normalizeExtraction({
  ...fixture({}),
  title: '',
  tasks: [{ task: '', category: 'call', urgency: 'high', context: '' }],
  reminders: [{ text: '', time: null, urgency: 'low' }],
});
assert.equal(blankRows.title, 'Untitled capture', 'blank local-model titles need a usable fallback');
assert.equal(blankRows.tasks.length, 0, 'blank model tasks must not be persisted');
assert.equal(blankRows.reminders.length, 0, 'blank model reminders must not be persisted');

assert.match(localReferenceTimestamp(new Date('2026-05-25T09:00:00-04:00')), /2026-05-25T09:00:00\.000[+-]\d{2}:\d{2}/);
assert.equal(protectedPreview('Startup product idea for a calendar'), 'Startup product idea for a calendar');
assert.match(protectedPreview('Password is SuperSecret123'), /Protected credential content/);
const protectedCredentialExtraction = protectCredentialExtraction(
  fixture({
    title: 'Password is ExampleOnly-4829',
    summary: 'Change ExampleOnly-4829 tonight.',
    tasks: [{ task: 'Change ExampleOnly-4829', category: 'other', urgency: 'medium', context: '' }],
  }),
  'My password is ExampleOnly-4829; I need to change it tonight.',
);
assert.equal(protectedCredentialExtraction.title, 'Protected credential thought');
assert.match(protectedCredentialExtraction.tasks[0].task, /Change protected credential/);
assert.doesNotMatch(JSON.stringify(protectedCredentialExtraction), /ExampleOnly-4829/);
const remoteRedaction = redactForRemote('The WiFi password is ExampleOnly-4829 and card 4111 1111 1111 1111 was replaced.');
assert.doesNotMatch(remoteRedaction.text, /ExampleOnly-4829|4111 1111 1111 1111/);
assert.match(remoteRedaction.text, /\[CREDENTIAL_1\]/);
assert.match(remoteRedaction.text, /\[CARD_2\]/);
assert.equal(remoteRedaction.replacements.length, 2);
assert.equal(
  applyRemoteRedactionMap('Use ExampleOnly-4829.', remoteRedaction.replacements),
  'Use [CREDENTIAL_1].',
);
assert.equal(
  restoreRemoteRedactions('Use [CREDENTIAL_1].', remoteRedaction.replacements),
  'Use ExampleOnly-4829.',
);
const explicitExpense = normalizeExtraction(extractExplicitEnglishFact('Paid 23 dollars for groceries today.'));
assert.equal(explicitExpense.expenses[0].amount, '23');
assert.equal(explicitExpense.expenses[0].category, 'food');
assert.equal(explicitExpense.expenses[0].description, 'Groceries');
const paymentTask = normalizeExtraction(extractExplicitEnglishFact('I need to pay the internet bill tomorrow.'));
assert.equal(paymentTask.tasks[0].task, 'Pay the internet bill tomorrow');
assert.equal(paymentTask.tasks[0].category, 'expense');
const explicitDecision = normalizeExtraction(extractExplicitEnglishFact('I decided to cancel my gym membership next month.'));
assert.match(explicitDecision.decisions[0], /Cancel my gym membership/);
assert.equal(extractExplicitEnglishFact('I discussed whether to cancel my membership.'), null);
const explicitProjectContext = normalizeExtraction(extractExplicitEnglishFact('Project Horizon involves Sam in Marketing area.'));
assert.deepEqual(explicitProjectContext.projects, ['Horizon']);
assert.deepEqual(explicitProjectContext.people, ['Sam']);
assert.deepEqual(explicitProjectContext.areas, ['Marketing']);
const scopedOfficeTask = normalizeExtraction(extractExplicitEnglishFact('For office work, I need to validate the dbt model in Snowflake today.'));
assert.deepEqual(scopedOfficeTask.areas, ['Office work']);
assert.equal(scopedOfficeTask.tasks[0].context, 'Office work');
assert.equal(scopedOfficeTask.tasks[0].urgency, 'high');
const scopedProjectTask = normalizeExtraction(extractExplicitEnglishFact('For ofc work project Data Platform, I need to validate dbt models in Snowflake today.'));
assert.deepEqual(scopedProjectTask.projects, ['Data Platform']);
assert.deepEqual(scopedProjectTask.areas, ['Ofc work']);
assert.equal(scopedProjectTask.tasks[0].context, 'Ofc work');
assert.match(formatStructuredMemory(scopedProjectTask), /Project: Data Platform \| Area: Ofc work/);
assert.match(formatStructuredMemory(scopedProjectTask), /Actions: Validate dbt models in Snowflake today \[high\]/);
assert.equal(isPaymentCompletionFollowUp('Paid'), true);
assert.equal(isPaymentCompletionFollowUp('Payment is done.'), true);
assert.equal(isPaymentCompletionFollowUp('I was paid today.'), false);
assert.equal(recognizesTodayPlanQuestion('What pending tasks and deadlines do I have for today?'), true);
assert.equal(recognizesTodayPlanQuestion('What should I read next month?'), false);
assert.equal(requestedTaskContext('What tasks related to office work do I have for today?'), 'office work');
assert.equal(recognizesMemoryMapQuestion('What is happening with Data Platform?'), true);
assert.equal(recognizesMemoryMapQuestion('Who is connected to Horizon?'), true);
assert.equal(recognizesMemoryMapQuestion('What office work keeps repeating?'), true);
assert.equal(normalizeMemoryLookupText('Office Work'), normalizeMemoryLookupText('Ofc work'));
assert.equal(recognizesMonthlySpendingQuestion('Summary of my payments this month?'), true);
assert.equal(recognizesMonthlySpendingQuestion('How much did I spend this month?'), true);
assert.equal(recognizesMonthlySpendingQuestion('What deadlines do I have today?'), false);
assert.equal(isInvalidPendingTask({ task: 'Paid' }), true);
assert.equal(isInvalidPendingTask({ task: 'Paid 17 dollars for soup today' }), true);
assert.equal(isInvalidPendingTask({ task: 'Buy Coffee' }), false);
assert.equal(isInvalidDeadline({ text: 'Paid 500 dollars for breakfast today.' }), true);
assert.equal(
  parseEnglishReminderTime('Remind me on May 26 2026 at 10:00 AM to call.', new Date(2026, 4, 25, 9)),
  new Date(2026, 4, 26, 10).toISOString(),
);
assert.equal(parseEnglishReminderTime('Remind me on February 31 2026 at 10:00 AM.'), null);
assert.equal(parseEnglishReminderTime('Remind me tomorrow at 25:00 PM.'), null);
const repaired = repairReminderTimes(
  fixture({ reminders: [{ text: 'Call', time: null, urgency: 'medium' }] }),
  'Remind me on May 26 2026 at 10:00 AM to call.',
);
assert.equal(repaired.reminders[0].time, new Date(2026, 4, 26, 10).toISOString());
assert.equal(
  captureStatus({ processed: -1 } as CaptureRow),
  'retrying',
  'failed processing should be displayed as an automatic background retry',
);
assert.equal(
  captureStatus({ processed: 3 } as CaptureRow),
  'archived',
  'ambiguous short updates can be retained without consuming retry work',
);
const organized = deriveKnowledgeProjection([
  {
    capture_id: 1,
    capture_created_at: '2026-05-25 12:00:00',
    privacy_level: 'normal',
    structured_json: JSON.stringify(fixture({ projects: ['Launch'], people: ['Sam'] })),
  },
  {
    capture_id: 2,
    capture_created_at: '2026-05-26 12:00:00',
    privacy_level: 'private',
    structured_json: JSON.stringify(fixture({ projects: ['Launch'], people: ['Sam'] })),
  },
]);
const launchEntity = organized.entities.find((entity) => entity.name === 'Launch');
const samLink = organized.connections.find((connection) => connection.relation === 'involves');
assert.equal(confidenceFromEvidence(1), 'emerging');
assert.equal(confidenceFromEvidence(2), 'supported');
assert.equal(confidenceFromEvidence(3), 'confirmed');
assert.equal(launchEntity?.evidenceCount, 2, 'repeated entity evidence should accumulate by capture');
assert.equal(launchEntity?.confidence, 'supported');
assert.equal(launchEntity?.privacyLevel, 'private', 'a derived entity containing private evidence stays private');
assert.equal(samLink?.evidenceCount, 2);
assert.equal(samLink?.confidence, 'supported');

console.log('Phase 1 Tanglish privacy tests passed: normal todo/expense writeable; ideas private and excluded.');
