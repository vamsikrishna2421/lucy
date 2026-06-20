/* Pure tests for follow-up dedup. Run: npx tsx tests/followUpDedup.ts */
import { isSimilarFollowUp, dedupeFollowUps } from '../src/processing/followUpDedup';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean) { if (cond) { pass++; } else { fail++; console.error('FAIL:', name); } }

// The real case (IMG_0913): one capture → three "Priya / send invoice" variants.
const fu = (assignee: string, action: string) => ({ assignee, action });
ok('same person, "send the invoice" ~ "send Vamsi the invoice"', isSimilarFollowUp(fu('Priya', 'Send the invoice'), fu('Priya', 'Send Vamsi the invoice')));
ok('same person, "send invoice" ~ "send the invoice"', isSimilarFollowUp(fu('Priya', 'Send invoice'), fu('Priya', 'Send the invoice')));
ok('the 3 Priya variants collapse to 1', dedupeFollowUps([
  fu('Priya', 'Send the invoice'),
  fu('Priya', 'Send Vamsi the invoice'),
  fu('Priya', 'Send invoice'),
]).length === 1);

// Different people → kept separate.
ok('different people not similar', isSimilarFollowUp(fu('Priya', 'send the invoice'), fu('Sam', 'send the invoice')) === false);
ok('different actions same person not similar', isSimilarFollowUp(fu('Priya', 'send the invoice'), fu('Priya', 'review the contract')) === false);
ok('two distinct follow-ups both kept', dedupeFollowUps([fu('Priya', 'send the invoice'), fu('Sam', 'book the venue')]).length === 2);

// Unnamed assignee acts as a wildcard (same action → dup).
ok('empty assignee matches by action', isSimilarFollowUp(fu('', 'send the report'), fu('Dana', 'send the report')));
// Empty actions never match.
ok('empty action → not similar', isSimilarFollowUp(fu('Priya', ''), fu('Priya', 'send invoice')) === false);

console.log(`\nfollowUpDedup: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
