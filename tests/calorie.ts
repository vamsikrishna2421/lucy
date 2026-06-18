/**
 * Tests for the pure calorie/energy engine. Run: npx tsx tests/calorie.ts
 */
import {
  bmrMifflin, bmrKatch, bmrFor, tdee, stepsToKcal, netCalorie, rollingAverage,
  safeCalorieGoal, macroTargets, sumNutrition, ageFromBirthYear, CALORIE_FLOOR, MAX_DEFICIT,
  type BodyProfile,
} from '../src/processing/calorieEngine';

let pass = 0; let fail = 0;
function ok(name: string, cond: boolean) { if (cond) { pass++; } else { fail++; console.error('  ✗ FAIL:', name); } }
const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;

// ── BMR ───────────────────────────────────────────────────────────────────────
// Mifflin male 80kg 180cm 30y = 10*80+6.25*180-5*30+5 = 800+1125-150+5 = 1780
ok('mifflin male known value', bmrMifflin({ sex: 'male', weightKg: 80, heightCm: 180, age: 30 }) === 1780);
// female same body = 1780 - 5 - 161... recompute: 800+1125-150-161 = 1614
ok('mifflin female known value', bmrMifflin({ sex: 'female', weightKg: 80, heightCm: 180, age: 30 }) === 1614);
// Katch: 370 + 21.6*LBM; 80kg @ 20% bf → LBM 64 → 370+1382.4 = 1752.4 → 1752
ok('katch known value', bmrKatch(80, 20) === 1752);
ok('bmrFor uses katch when bodyfat known', bmrFor({ sex: 'male', birthYear: 1995, heightCm: 180, weightKg: 80, bodyFatPct: 20, activityLevel: 'moderate', goal: 'maintain' }) === 1752);
ok('bmrFor uses mifflin when no bodyfat', bmrFor({ sex: 'male', birthYear: new Date().getFullYear() - 30, heightCm: 180, weightKg: 80, bodyFatPct: null, activityLevel: 'moderate', goal: 'maintain' }) === 1780);

// ── TDEE: measured vs estimated, NO double-count ───────────────────────────────
{
  const measured = tdee({ bmr: 1780, activeEnergyKcal: 600, activityLevel: 'very_active' });
  ok('tdee measured = bmr + active (ignores activity factor)', measured.tdee === 2380 && measured.source === 'measured');
  const estimated = tdee({ bmr: 1780, activeEnergyKcal: null, activityLevel: 'sedentary' });
  ok('tdee estimated = bmr * factor', estimated.tdee === Math.round(1780 * 1.2) && estimated.source === 'estimated');
  const zeroActive = tdee({ bmr: 1780, activeEnergyKcal: 0, activityLevel: 'light' });
  ok('tdee 0 active → estimated fallback', zeroActive.source === 'estimated');
}

// ── steps→kcal ─────────────────────────────────────────────────────────────────
ok('stepsToKcal ~350 for 10k @70kg', near(stepsToKcal(10000, 70), 350, 1));
ok('stepsToKcal 0 for 0 steps', stepsToKcal(0, 70) === 0);
ok('stepsToKcal never negative', stepsToKcal(-5, 70) === 0);

// ── net + rolling ──────────────────────────────────────────────────────────────
ok('net deficit negative', netCalorie(1800, 2300) === -500);
ok('net surplus positive', netCalorie(2600, 2300) === 300);
ok('rollingAverage ignores nulls', rollingAverage([-500, null, -300, undefined, -100]) === -300);
ok('rollingAverage empty → null', rollingAverage([null, undefined]) === null);

// ── safety clamps ────────────────────────────────────────────────────────────────
ok('lose caps deficit at 500', safeCalorieGoal('lose', 2300) === 2300 - MAX_DEFICIT);
ok('lose never below floor', safeCalorieGoal('lose', 1500) === CALORIE_FLOOR); // 1500-500=1000 < 1200 → floor
ok('maintain = tdee', safeCalorieGoal('maintain', 2300) === 2300);
ok('gain = tdee + surplus', safeCalorieGoal('gain', 2300) === 2800);
ok('zero tdee → floor', safeCalorieGoal('lose', 0) === CALORIE_FLOOR);

// ── macros ───────────────────────────────────────────────────────────────────────
{
  const m = macroTargets(2000, 70);
  ok('protein ~1.6g/kg', m.protein_g === Math.round(1.6 * 70));
  ok('macro calories ≈ goal', near(m.protein_g * 4 + m.carbs_g * 4 + m.fat_g * 9, 2000, 12));
  ok('macros all positive', m.protein_g > 0 && m.carbs_g > 0 && m.fat_g > 0);
}

// ── sumNutrition ───────────────────────────────────────────────────────────────
{
  const s = sumNutrition([{ calories: 300, protein_g: 20 }, { calories: 250, protein_g: 10, carbs_g: 30 }, {}]);
  ok('sum calories', s.calories === 550);
  ok('sum protein', s.protein_g === 30);
  ok('sum handles missing macros', s.carbs_g === 30 && s.fat_g === 0);
}

ok('ageFromBirthYear sane', ageFromBirthYear(1990) > 20 && ageFromBirthYear(3000) === 30);

console.log(`\ncalorie: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
