/* Pure tests for the local Indian-food portion DB. Run: npx tsx tests/foodDb.ts */
import { lookupMeal, parseQty, matchFood, FOOD_DB } from '../src/processing/foodDb';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean) { if (cond) { pass++; } else { fail++; console.error('FAIL:', name); } }

// parseQty
ok('digit qty', parseQty('2 rotis') === 2);
ok('x-notation qty', parseQty('idli x3') === 3);
ok('word qty', parseQty('three idlis') === 3);
ok('"a" → 1', parseQty('a katori dal') === 1);
ok('"couple" → 2', parseQty('couple of idlis') === 2);
ok('default 1', parseQty('rice') === 1);

// matchFood — longest alias wins, aliases work
ok('roti via plural', matchFood('2 rotis')?.display === 'Roti');
ok('masala dosa beats dosa', matchFood('one masala dosa')?.display === 'Masala dosa');
ok('chicken biryani beats biryani', matchFood('chicken biryani')?.display === 'Chicken biryani');
ok('alias dahi → Curd', matchFood('a katori of dahi')?.display === 'Curd');
ok('no match → null', matchFood('thai green curry') === null);

// lookupMeal — the headline case
{
  const r = lookupMeal('2 rotis and a katori of dal');
  ok('fully resolved meal', r.unresolved.length === 0 && r.items.length === 2);
  const roti = r.items.find((i) => i.name === 'Roti');
  ok('roti qty 2', roti?.qty === 2);
  ok('roti calories scaled (2×80=160)', roti?.calories === 160);
  ok('dal present', r.items.some((i) => i.name === 'Dal' && i.calories === 140));
}
{
  const r = lookupMeal('idli x3 and sambar');
  ok('idli ×3 = 165 kcal', r.items.find((i) => i.name === 'Idli')?.calories === 165);
  ok('sambar resolved', r.items.some((i) => i.name === 'Sambar'));
  ok('no unresolved', r.unresolved.length === 0);
}

// novel meal → unresolved (so caller falls back to LLM)
{
  const r = lookupMeal('leftover thai green curry');
  ok('novel meal → no DB items', r.items.length === 0);
  ok('novel meal → unresolved', r.unresolved.length === 1);
}
// partial: known + unknown → unresolved flags the unknown
{
  const r = lookupMeal('2 rotis and some pasta');
  ok('partial: roti matched', r.items.some((i) => i.name === 'Roti'));
  ok('partial: pasta unresolved', r.unresolved.some((u) => /pasta/i.test(u)));
}
// filler-only fragments don't count as unresolved
ok('"had lunch today" → nothing unresolved', lookupMeal('had lunch today').unresolved.length === 0);

ok('DB has a healthy seed size', FOOD_DB.length >= 40);

console.log(`\nfoodDb: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
