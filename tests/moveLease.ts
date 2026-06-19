/* Pure tests for the move/lease autopilot foundation. Run: npx tsx tests/moveLease.ts */
import {
  detectMoveLease,
  extractNoticePeriodDays,
  noticeDeadline,
  relocationPlan,
  RELOCATION_CHECKLIST,
} from '../src/processing/moveLease';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean) { if (cond) { pass++; } else { fail++; console.error('FAIL:', name); } }

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();

// ── detectMoveLease ──────────────────────────────────────────────────────────────
const lease = detectMoveLease('My lease is up and I need to give 30 days notice by Friday to my landlord Dana.', now);
ok('detects a lease note', !!lease && lease.kind === 'lease');
ok('lease: parses notice period', lease?.noticeDays === 30);
ok('lease: pulls the landlord name', lease?.counterparty === 'Dana');
ok('lease: surfaces a lease-end date', !!lease && lease.dates.some((d) => d.label === 'Lease ends' && !!d.dueISO));

const move = detectMoveLease("We're moving to the new apartment, hopefully done by Saturday.", now);
ok('detects a move note', !!move && move.kind === 'move');
ok('move: surfaces a move date', !!move && move.dates.some((d) => d.label === 'Move date' && !!d.dueISO));

ok('relocation phrasing is a move', detectMoveLease('Planning my relocation next month.', now)?.kind === 'move');
ok('deposit/landlord phrasing is a lease', detectMoveLease('Still need to chase my security deposit from the old landlord.', now)?.kind === 'lease');
ok('unrelated note → null', detectMoveLease('Had a great coffee with friends today.', now) === null);
ok('empty → null', detectMoveLease('', now) === null);

// ── extractNoticePeriodDays ──────────────────────────────────────────────────────
ok('"60 days notice" → 60', extractNoticePeriodDays('give 60 days notice') === 60);
ok('"2 months notice" → 60', extractNoticePeriodDays('they want 2 months notice') === 60);
ok('"notice period of 30 days" → 30', extractNoticePeriodDays('the notice period of 30 days applies') === 30);
ok('"3 weeks notice" → 21', extractNoticePeriodDays('3 weeks notice required') === 21);
ok('no number → null', extractNoticePeriodDays('you must give notice') === null);
ok('unrelated → null', extractNoticePeriodDays('just a normal sentence') === null);

// ── noticeDeadline (pure arithmetic: lease end minus notice) ──────────────────────
const end = '2026-09-30T12:00:00.000Z';
const endMs = Date.parse(end);
ok('notice deadline = end − 30d (default)', Date.parse(noticeDeadline(end) ?? '') === endMs - 30 * DAY);
ok('notice deadline = end − 60d (custom)', Date.parse(noticeDeadline(end, 60) ?? '') === endMs - 60 * DAY);
ok('zero/invalid noticeDays falls back to 30', Date.parse(noticeDeadline(end, 0) ?? '') === endMs - 30 * DAY);
ok('invalid lease end → null', noticeDeadline('not a date') === null);

// ── RELOCATION_CHECKLIST + relocationPlan ────────────────────────────────────────
ok('checklist has the standard steps', RELOCATION_CHECKLIST.length >= 10);
ok('checklist leads with giving notice', /notice/i.test(RELOCATION_CHECKLIST[0].task));
ok('checklist covers the deposit', RELOCATION_CHECKLIST.some((s) => /deposit/i.test(s.task)));

const moveDate = new Date(now + 20 * DAY).toISOString();
const plan = relocationPlan(moveDate, now);
ok('plan has one dated task per checklist step', plan.length === RELOCATION_CHECKLIST.length);
ok('plan preserves task order', plan[0].task === RELOCATION_CHECKLIST[0].task);
ok('past-dated steps are clamped to now (nothing in the past)', plan.every((p) => Date.parse(p.dueISO) >= now));
ok('a post-move step lands in the future', Date.parse(plan[plan.length - 1].dueISO) > now);
ok('invalid move date → empty plan', relocationPlan('nope').length === 0);

console.log(`\nmoveLease: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
