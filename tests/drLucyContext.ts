/* Pure tests for Dr. Lucy contextual guardian. Run: npx tsx tests/drLucyContext.ts */
import { contextualGuidance, type DayContext } from '../src/processing/drLucyContext';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean) { if (cond) { pass++; } else { fail++; console.error('FAIL:', name); } }

const day = (o: Partial<DayContext>): DayContext => ({ dateKey: '2026-06-20', calories: 0, carbs_g: 0, meals: [], stressed: false, sleep_hours: null, ...o });

// A) skipped midday meal + late eating → flagged
{
  const g = contextualGuidance([day({ calories: 1800, meals: [{ mealType: 'breakfast', hour: 8 }, { mealType: 'snack', hour: 21 }] })]);
  ok('skipped-lunch + late eating flagged', g.some((x) => /midday meal and ended up eating late/.test(x.observation)));
}
// midday meal present → NOT flagged
{
  const g = contextualGuidance([day({ calories: 1800, meals: [{ mealType: 'breakfast', hour: 8 }, { mealType: 'lunch', hour: 13 }, { mealType: 'dinner', hour: 20 }] })]);
  ok('has lunch → not flagged for skipped midday', !g.some((x) => /midday/.test(x.observation)));
}
// only one meal → not enough signal
ok('single meal → no skip insight', !contextualGuidance([day({ calories: 600, meals: [{ mealType: 'snack', hour: 22 }] })]).some((x) => /midday/.test(x.observation)));

// B) stress ↔ higher intake across the window
{
  const days = [
    day({ dateKey: 'd1', calories: 2600, stressed: true }),
    day({ dateKey: 'd2', calories: 2500, stressed: true }),
    day({ dateKey: 'd3', calories: 2000, stressed: false }),
    day({ dateKey: 'd4', calories: 1900, stressed: false }),
  ];
  const g = contextualGuidance(days);
  ok('stress→higher-calorie flagged', g.some((x) => /more stressful days have run higher-calorie/.test(x.observation)));
}
// no skew → not flagged
{
  const days = [
    day({ dateKey: 'd1', calories: 2000, stressed: true }),
    day({ dateKey: 'd2', calories: 2050, stressed: true }),
    day({ dateKey: 'd3', calories: 2000, stressed: false }),
    day({ dateKey: 'd4', calories: 1980, stressed: false }),
  ];
  ok('similar intake → no stress skew insight', !contextualGuidance(days).some((x) => /higher-calorie/.test(x.observation)));
}
// not enough samples → no claim
ok('too few stressed days → no skew', !contextualGuidance([day({ calories: 2600, stressed: true }), day({ calories: 2000, stressed: false })]).some((x) => /higher-calorie/.test(x.observation)));

// caps + safety
ok('caps at 2', contextualGuidance([
  day({ calories: 2600, stressed: true, meals: [{ mealType: 'breakfast', hour: 8 }, { mealType: 'snack', hour: 21 }] }),
  day({ calories: 2500, stressed: true }),
  day({ calories: 2000, stressed: false }),
  day({ calories: 1900, stressed: false }),
]).length <= 2);
ok('empty data → no guidance', contextualGuidance([]).length === 0);
ok('all gentle severity', contextualGuidance([day({ calories: 1800, meals: [{ mealType: 'breakfast', hour: 8 }, { mealType: 'snack', hour: 21 }] })]).every((x) => x.severity === 'gentle'));

console.log(`\ndrLucyContext: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
