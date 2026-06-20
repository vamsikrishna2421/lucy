/* Pure tests for errand batching. Run: npx tsx tests/errandBatch.ts */
import { groupErrands, errandBatchNudge } from '../src/processing/errandBatch';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean) { if (cond) { pass++; } else { fail++; console.error('FAIL:', name); } }
const t = (task: string, category?: string) => ({ task, category });

const todos = [
  t('Pick up dry cleaning'),
  t('Buy milk and eggs'),
  t('Return the Amazon package'),
  t('Call the dentist'),
  t('Email Sarah the deck'),
  t('Finish the design doc'), // not an errand
];

const g = groupErrands(todos);
ok('out errands grouped (pickup/buy/return)', g.out.length === 3);
ok('call/message errands grouped (call/email)', g.calls.length === 2);
ok('non-errand excluded', !g.out.includes('Finish the design doc') && !g.calls.includes('Finish the design doc'));
ok('category=errand counts as out', groupErrands([t('xyz', 'errand')]).out.length === 1);
ok('an out-errand is not double-counted as a call', groupErrands([t('call to pick up parcel')]).out.length === 1 && groupErrands([t('call to pick up parcel')]).calls.length === 0);

// nudge thresholds
ok('3+ out errands → nudge mentions batching', /knock them out together/.test(errandBatchNudge(todos) ?? ''));
ok('below threshold → null', errandBatchNudge([t('Buy milk'), t('Call mom')]) === null);
ok('3+ calls → calls nudge', /batch them in one sitting/.test(errandBatchNudge([t('call a'), t('text b'), t('email c')]) ?? ''));
ok('nothing errand-y → null', errandBatchNudge([t('write report'), t('read book')]) === null);

console.log(`\nerrandBatch: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
