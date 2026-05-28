import assert from 'node:assert/strict';
import { analyzeWithClaude } from '../src/ai/claude';
import { classifyPrivacy } from '../src/processing/privacy';

async function run(): Promise<void> {
  const todoSample = 'Repu morning 9 ki landlord ki call cheyyali, urgent ga remind cheyyi.';
  const expenseSample = 'Ninna auto ki 180 pay chesa, expense lo add cheyyali.';
  const privateSample = 'Na startup idea: local ga family memories organize chese private app build cheyyali.';

  assert.equal(classifyPrivacy(privateSample).level, 'private', 'private sample must be stopped before Claude');

  const [todo, expense] = await Promise.all([
    analyzeWithClaude(todoSample),
    analyzeWithClaude(expenseSample),
  ]);
  assert.ok(todo.tasks.length > 0 || todo.reminders.length > 0, 'Claude should extract an action or reminder');
  assert.ok(expense.expenses.length > 0, 'Claude should extract an expense');

  console.log('Live Claude validation passed for normal Tanglish todo and expense samples; private idea was not sent.');
}

void run();
