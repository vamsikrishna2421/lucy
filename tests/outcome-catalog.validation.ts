import assert from 'node:assert/strict';
import { outcomeCases, outcomeGroups, remoteComparableCases } from './outcome-catalog';

assert.equal(outcomeGroups.length, 10, 'The evaluation catalog must contain ten product outcomes.');
outcomeGroups.forEach((outcome) => {
  assert.equal(
    outcomeCases.filter((test) => test.outcome === outcome).length,
    10,
    `${outcome} must contain ten test cases.`,
  );
});
assert.equal(outcomeCases.length, 100, 'The catalog must contain one hundred outcome cases.');
assert.ok(remoteComparableCases.length > 0, 'At least one safe remote-comparable case is required.');
assert.equal(
  outcomeCases.filter((test) => test.outcome === 'privacy-boundary' && test.execution !== 'local-only').length,
  0,
  'Privacy-boundary cases must never be remote-comparable.',
);
assert.equal(
  outcomeCases.filter((test) => test.outcome === 'ideas' && test.execution !== 'local-only').length,
  0,
  'Idea cases stay local-only under the current privacy contract.',
);

console.log(`Outcome catalog ready: ${outcomeCases.length} cases across ${outcomeGroups.length} outcomes; ${remoteComparableCases.length} safe model-comparable cases.`);
