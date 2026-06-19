/**
 * Semantic tool layer — pure-unit tests (no LLM/DB/RN). Covers description rendering, the selector's
 * JSON parsing + fallbacks, and merge prose assembly. Run: npx tsx tests/toolRouter.ts
 */
import { describeForSelector } from '../src/processing/tools/describe';
import { parseSelection, buildSelectorPrompt, fastRoute } from '../src/processing/tools/selector';
import { assembleProse } from '../src/processing/tools/merge';
import type { LucyTool } from '../src/processing/tools/types';

let pass = 0; let fail = 0;
function ok(name: string, cond: boolean) { if (cond) { pass++; } else { fail++; console.error('  ✗ FAIL:', name); } }

const stub = (name: string, description: string): LucyTool => ({ name, description, run: async () => ({ kind: name, data: {}, prose: '' }) });
const tools = [stub('spending', 'money you spent'), stub('memory', 'recall notes')];
const names = tools.map((t) => t.name);

// describe + prompt
ok('describeForSelector lists both', /spending:/.test(describeForSelector(tools)) && /memory:/.test(describeForSelector(tools)));
ok('selector prompt embeds tools + question', (() => { const p = buildSelectorPrompt('how much did I spend?', tools); return p.user === 'how much did I spend?' && /spending:/.test(p.system); })());

// parseSelection — happy path
{
  const sel = parseSelection('{"tools":[{"name":"spending","args":{}}],"reason":"money"}', 'how much did I spend?', names);
  ok('parses spending', sel.tools.length === 1 && sel.tools[0].name === 'spending');
  ok('injects question into args', sel.tools[0].args.question === 'how much did I spend?');
}
ok('unknown tool → memory fallback', (() => { const s = parseSelection('{"tools":[{"name":"banana"}]}', 'x', names); return s.tools.length === 1 && s.tools[0].name === 'memory'; })());
ok('empty tools → memory', parseSelection('{"tools":[]}', 'x', names).tools[0].name === 'memory');
ok('garbage → memory fallback', parseSelection('not json at all', 'x', names).tools[0].name === 'memory');
{
  const sel = parseSelection('{"tools":[{"name":"spending"},{"name":"spending"},{"name":"memory"}]}', 'x', names);
  ok('dedupes repeated tool', sel.tools.length === 2 && sel.tools[0].name === 'spending' && sel.tools[1].name === 'memory');
}
ok('parses JSON embedded in prose', parseSelection('Sure! {"tools":[{"name":"memory"}]} done', 'x', names).tools[0].name === 'memory');

// P1 tools: parseSelection validates against the full 7-tool name set
{
  const all = ['spending', 'tasks', 'health', 'reminders', 'people', 'knowledge', 'memory'];
  ok('routes to tasks', parseSelection('{"tools":[{"name":"tasks"}]}', 'what are my tasks today', all).tools[0].name === 'tasks');
  ok('routes to health', parseSelection('{"tools":[{"name":"health"}]}', 'how many calories left', all).tools[0].name === 'health');
  ok('routes to people', parseSelection('{"tools":[{"name":"people"}]}', 'who is Priya', all).tools[0].name === 'people');
  ok('routes to knowledge', parseSelection('{"tools":[{"name":"knowledge"}]}', 'how does Genie relate to Sales', all).tools[0].name === 'knowledge');
  ok('routes to reminders', parseSelection('{"tools":[{"name":"reminders"}]}', 'what reminders do I have', all).tools[0].name === 'reminders');
  // multi-tool compose (spending + memory) preserved + order kept
  const multi = parseSelection('{"tools":[{"name":"spending"},{"name":"memory"}]}', 'what did I spend on the trip', all);
  ok('multi-tool compose', multi.tools.length === 2 && multi.tools[0].name === 'spending' && multi.tools[1].name === 'memory');
}

// fastRoute — single clear domain skips the LLM selector; multi/none defers to it
ok('fastRoute spending', fastRoute('how much did I spend on food last week') === 'spending');
ok('fastRoute tasks', fastRoute('what are my pending tasks') === 'tasks');
ok('fastRoute health', fastRoute('how many calories left today') === 'health');
ok('fastRoute reminders', fastRoute('what reminders do I have') === 'reminders');
ok('fastRoute people', fastRoute('who is Monisha') === 'people');
ok('fastRoute money_watch (subscriptions)', fastRoute('what subscriptions am I paying for') === 'money_watch');
ok('fastRoute money_watch (bills)', fastRoute('any bills coming up soon') === 'money_watch');
ok('fastRoute keep_in_touch', fastRoute("who haven't I talked to in a while") === 'keep_in_touch');
ok('fastRoute reach out', fastRoute('who should I reach out to') === 'keep_in_touch');
ok('fastRoute commitments (promise)', fastRoute('what did I promise this week') === 'commitments');
ok('fastRoute commitments (owe)', fastRoute('what do I owe anyone') === 'commitments');
ok('fastRoute commitments (owes me)', fastRoute('who owes me anything') === 'commitments');
ok('fastRoute commitments (waiting)', fastRoute('what am I waiting on from others') === 'commitments');
ok('fastRoute multi-domain → null (LLM decides)', fastRoute('how am I doing on health and money') === null);
ok('fastRoute vague → null', fastRoute('what should I think about') === null);

// assembleProse
ok('assembleProse joins fragments', assembleProse([
  { name: 'spending', result: { kind: 'spending', data: {}, prose: 'You spent 50.' } },
  { name: 'memory', result: { kind: 'memory', data: {}, prose: 'Note: dinner.' } },
]) === 'You spent 50.\n\nNote: dinner.');
ok('assembleProse skips empty', assembleProse([{ name: 'memory', result: { kind: 'memory', data: {}, prose: '' } }]) === '');

console.log(`\ntoolRouter: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
