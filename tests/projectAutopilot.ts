/* Pure tests for project-autopilot near-duplicate detection. Run: npx tsx tests/projectAutopilot.ts */
import { isNearExisting, splitHeadline } from '../src/processing/projectAutopilot';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean) { if (cond) { pass++; } else { fail++; console.error('FAIL:', name); } }

const existing = ['Lucy', 'AI learning', 'CineBuddy'];

// The reported bug: "Lucy app" must be recognized as the existing "Lucy" (generic "app" dropped).
ok('"Lucy app" is near existing "Lucy"', isNearExisting('Lucy app', existing) === true);
ok('"Lucy" exact-ish is near', isNearExisting('Lucy', existing) === true);
ok('"Lucy mobile application" is near', isNearExisting('Lucy mobile application', existing) === true);

// A genuinely different project is NOT suppressed (merge button handles those, not dedup).
ok('"Manus AI exploration" is NOT near "AI learning"', isNearExisting('Manus AI exploration', existing) === false);
ok('"CineBuddy" matches itself', isNearExisting('CineBuddy', existing) === true);
ok('a brand-new name is not near', isNearExisting('Kitchen renovation', existing) === false);

// Generic-only candidates never match (no meaningful tokens).
ok('generic-only "the app" not near', isNearExisting('the app', existing) === false);

// Token overlap / subset both directions.
ok('superset existing is near', isNearExisting('Genie', ['Genie data platform']) === true);
ok('half-overlap counts as near (jaccard>=0.5)', isNearExisting('budget tracker', ['budget planner tracker']) === true);
ok('single existing token fully contained is near', isNearExisting('home loan paperwork', ['home']) === true);
ok('unrelated multiword not near', isNearExisting('weekend trip plan', ['quarterly tax filing']) === false);

// ── splitHeadline (tidy a long project name → headline + description) ─────────────
{
  const r = splitHeadline('Interactive Food Bowl Builder App — Tap-to-Assemble Salad & Protein Ordering UI');
  ok('splits on em dash → headline', r.headline === 'Interactive Food Bowl Builder App');
  ok('splits on em dash → description', r.description === 'Tap-to-Assemble Salad & Protein Ordering UI');
}
ok('splits on colon', splitHeadline('Move: notice, movers, deposit, utilities').headline === 'Move');
ok('splits on spaced hyphen', splitHeadline('CineBuddy - a movie night planner').description === 'a movie night planner');
ok('no separator → name unchanged, empty desc', (() => { const r = splitHeadline('AI learning'); return r.headline === 'AI learning' && r.description === ''; })());
ok('leading separator is ignored', splitHeadline('— stray dash lead').headline === '— stray dash lead');

console.log(`\nprojectAutopilot: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
