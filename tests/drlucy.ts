/**
 * Tests for Dr. Lucy's deterministic safety + guardian logic. Run: npx tsx tests/drlucy.ts
 */
import { detectRedFlag, assessIntake, evaluateGuardian } from '../src/processing/drLucy';
import type { HealthSummary } from '../src/processing/healthSummary';

let pass = 0; let fail = 0;
function ok(name: string, cond: boolean) { if (cond) { pass++; } else { fail++; console.error('  ✗ FAIL:', name); } }

function summary(over: Partial<HealthSummary> = {}): HealthSummary {
  return {
    date: '2026-06-17', profileComplete: true,
    activity: { steps: 8000, sleep_hours: 7.5, resting_hr: 60, active_minutes: 30, active_energy_kcal: 300, active_energy_source: 'estimated' },
    energy: { bmr: 1600, tdee: 2200, tdee_source: 'measured' },
    intake: { calories: 1800, protein_g: 90, carbs_g: 200, fat_g: 60, items: [] },
    goals: { calorie_goal: 1900, protein_g: 110, carbs_g: 200, fat_g: 60 },
    remaining: 100, net: -400, net_rolling_7: -300, drLucy: [],
    ...over,
  };
}

// ── RED FLAGS (must always catch + override) ───────────────────────────────────
ok('detects chest pain', detectRedFlag('I have bad chest pain right now')?.kind === 'cardiac');
ok('detects breathing', !!detectRedFlag("I can't breathe properly"));
ok('detects stroke signs', !!detectRedFlag('my face is drooping and speech slurred'));
ok('detects suicidal ideation → crisis', detectRedFlag('I want to kill myself')?.kind === 'crisis');
ok('crisis message points to 988', /988/.test(detectRedFlag('thinking of self-harm')?.message ?? ''));
ok('detects fainting', !!detectRedFlag('I just passed out'));
ok('benign text → no red flag', detectRedFlag('what should I eat for lunch?') === null);
ok('benign "chest workout" not flagged', detectRedFlag('I did a chest workout today') === null);

// ── ED-safe intake ─────────────────────────────────────────────────────────────
ok('low intake in evening → care', assessIntake(summary({ intake: { calories: 700, protein_g: 0, carbs_g: 0, fat_g: 0, items: [] } }), 20).tooLow === true);
ok('low intake midday → NOT flagged yet', assessIntake(summary({ intake: { calories: 700, protein_g: 0, carbs_g: 0, fat_g: 0, items: [] } }), 13).tooLow === false);
ok('zero logged → not flagged (nothing logged yet)', assessIntake(summary({ intake: { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, items: [] } }), 21).tooLow === false);
ok('normal intake → not flagged', assessIntake(summary(), 21).tooLow === false);
ok('intake care never says eat less', !/eat less|cut back|reduce/i.test(assessIntake(summary({ intake: { calories: 700, protein_g: 0, carbs_g: 0, fat_g: 0, items: [] } }), 20).observation ?? ''));

// ── guardian rules ───────────────────────────────────────────────────────────────
{
  const g = evaluateGuardian(summary(), { resting_hr: 60 }, 14);
  ok('healthy day → silence (no nags)', g.length === 0);
}
{
  // steep deficit trend → caution
  const g = evaluateGuardian(summary({ net_rolling_7: -900 }), {}, 14);
  ok('steep deficit → caution flagged', g.some((x) => x.category === 'nutrition' && x.severity === 'caution'));
  ok('deficit guidance never encourages eating less', !g.some((x) => /eat less|cut/i.test(x.observation + (x.suggestion ?? ''))));
}
{
  // short sleep
  const g = evaluateGuardian(summary({ activity: { ...summary().activity, sleep_hours: 5 } }), {}, 14);
  ok('short sleep → gentle', g.some((x) => x.category === 'sleep' && x.severity === 'gentle'));
}
{
  // RHR elevated vs baseline
  const g = evaluateGuardian(summary({ activity: { ...summary().activity, resting_hr: 72 } }), { resting_hr: 60 }, 14);
  ok('elevated RHR vs baseline → caution', g.some((x) => x.category === 'heart' && x.severity === 'caution'));
}
{
  // care (low intake) sorts before other items + caps at 2
  const g = evaluateGuardian(summary({ intake: { calories: 600, protein_g: 0, carbs_g: 0, fat_g: 0, items: [] }, net_rolling_7: -900, activity: { ...summary().activity, sleep_hours: 5, resting_hr: 75 } }), { resting_hr: 60 }, 20);
  ok('care guidance sorts first', g[0]?.severity === 'care');
  ok('capped at 2 guidance items', g.length === 2);
}
{
  // incomplete profile → no intake care (can't judge), still safe
  const g = evaluateGuardian(summary({ profileComplete: false }), {}, 20);
  ok('incomplete profile → no false intake flag', !g.some((x) => x.category === 'nutrition' && x.severity === 'care'));
}

console.log(`\ndrlucy: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
