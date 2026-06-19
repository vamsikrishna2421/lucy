/* Pure tests for the savings-goal detector. Run: npx tsx tests/goalDetect.ts */
import { detectSavingsGoal } from '../src/processing/goalDetect';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean) { if (cond) { pass++; } else { fail++; console.error('FAIL:', name); } }

const now = new Date(2026, 5, 19, 12, 0, 0).getTime(); // Fri Jun 19 2026

// core: amount + label + deadline
{
  const g = detectSavingsGoal('I want to save 2000 for the move by August 31', now);
  ok('detects a goal', !!g);
  ok('target 2000', g?.target === 2000);
  ok('label from "for the move"', g?.label === 'Move');
  ok('deadline parsed (Aug 31)', !!g?.deadlineISO && new Date(g!.deadlineISO!).getMonth() === 7);
  ok('default currency ₹', g?.currency === '₹');
}

// currency symbol + "for"
{
  const g = detectSavingsGoal('saving $5,000 for a new laptop', now);
  ok('$ currency', g?.currency === '$');
  ok('comma amount 5000', g?.target === 5000);
  ok('label New laptop', g?.label === 'New laptop');
  ok('no deadline → null deadline but still a goal', g?.deadlineISO === null);
}

// magnitude suffixes
ok('2k → 2000', detectSavingsGoal('set aside 2k for vacation', now)?.target === 2000);
ok('50k → 50000', detectSavingsGoal('save 50k for the deposit', now)?.target === 50000);
ok('2 lakh → 200000', detectSavingsGoal('put aside 2 lakh for the wedding', now)?.target === 200000);

// bare-month deadline ("by August", no day)
{
  const g = detectSavingsGoal('save 1000 for the trip by September', now);
  ok('bare month → end of month', !!g?.deadlineISO && new Date(g!.deadlineISO!).getMonth() === 8 && new Date(g!.deadlineISO!).getDate() >= 29);
}

// deadline-only (no "for") still works, default label
{
  const g = detectSavingsGoal('I should save 3000 by next Friday', now);
  ok('deadline-only goal', !!g && g.target === 3000);
  ok('default label Savings', g?.label === 'Savings');
}

// negatives
ok('"save 5 minutes" is not a goal', detectSavingsGoal('that will save 5 minutes', now) === null);
ok('"save the date" no amount', detectSavingsGoal('save the date for the party', now) === null);
ok('vague "save 200" no label/deadline', detectSavingsGoal('try to save 200', now) === null);
ok('no save intent → null', detectSavingsGoal('spent 2000 on the move', now) === null);
ok('empty → null', detectSavingsGoal('', now) === null);

console.log(`\ngoalDetect: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
