# Lucy Health — Strategy (Calorie Spend + Calorie Intake + Dr. Lucy Guardian)

> Synthesis of three research passes (Cal AI feature teardown, HealthKit/activity metrics +
> engagement design, and the "Dr. Lucy" doctor-guardian persona) mapped onto Lucy's real
> architecture. Goal: turn the minimal Health tab into a two-sided, engaging, safe health
> companion. **Research/strategy only — no code shipped yet.**

## Where we are today (ground truth)
- `health_snapshots` table: `steps` (expo-sensors Pedometer), `sleep_hours` + `resting_hr` (HealthKit,
  best-effort), `active_minutes`. Populated by `src/processing/recordLifeContext.ts`.
- `mood_entries`: tone logs.
- `HealthView` in `src/screens/Dashboard.tsx` (line ~553): today's steps/sleep/HR cards, a 7-day bar
  chart, mood distribution, one static `generateHealthTip`.
- AI: `askLucy`/`answerWithLLM` (`src/processing/ask.ts`) with `buildUserContextPrefix` (learned
  profile), on-device Phi-4 (ExecuTorch) + remote OpenAI/Claude, the privacy shield, and the voice
  command/conversation pipeline. Notifications infra exists (`initializeNotifications`, scheduled
  reminders).
- **No calorie intake at all today.**

## Target shape: Health becomes three sub-areas
1. **Activity & Energy ("calorie spend")** — expand the current side: rings, streaks, richer metrics,
   calories burned (TDEE), trends. Engaging but humane.
2. **Nutrition ("calorie intake")** — new: Cal-AI-class food logging (photo / barcode / voice / text),
   daily calorie + macro budget, meal timeline.
3. **Dr. Lucy** — a caring-doctor guardian that watches both sides + sleep/mood and proactively
   guides/warns/encourages, with hard medical & eating-disorder safety guardrails.

---

## Key architectural decisions (decide before building)

1. **Photo food logging needs cloud vision.** On-device can do barcode scan, label OCR, and DB
   search. Accurate photo→macros (multi-food + portions) realistically needs a cloud multimodal model
   (GPT-4o / Gemini-class). Lucy already supports a remote provider (user's OpenAI/Claude key) and a
   privacy shield → route the photo scan through the remote provider, keep everything else on-device,
   and use confidence-based routing. A food photo is less sensitive than a password, but still apply
   the shield posture and make remote vision clearly opt-in.
2. **Deeper HealthKit reads = native dependency = Codemagic build.** Recommend
   `@kingstinct/react-native-healthkit` (TS-first, New-Arch-safe) for iOS; `react-native-health-connect`
   for Android parity later. Camera/vision + barcode scanner are also native deps. **All of this is a
   rebuild with build risk (like executorch/tcp-socket) — gate it with an early Codemagic build before
   building the full UI.**
3. **Engine vs LLM split for Dr. Lucy.** A deterministic typed **rule table** decides *what/whether*
   to say and the **severity**; the LLM only *voices* it. A **safety classifier + calorie floors run
   before the LLM** and can hard-override. The LLM never invents triggers from raw data (prevents
   hallucinated medical claims).
4. **Privacy-first stays.** Store **daily roll-ups** on-device; only aggregated/abstracted signals
   ("RHR up ~6 bpm this week") ever go to a remote LLM. Clinical/cycle data never leaves device.

---

## Data model (new / changed)

`daily_health` (one row per local day — supersedes `health_snapshots`, migrate forward):
movement/energy (steps, distance, flights, active_energy_kcal, resting_energy_kcal, total_energy_kcal/TDEE,
exercise_minutes, stand_hours), cardio/recovery (resting_hr, walking_hr_avg, hrv_sdnn, vo2max,
respiratory_rate, spo2 — all nullable/Watch-dependent), sleep (total/core/deep/rem/awake min, start/end),
wellness (mindful_min, water_ml, mood_score), body (weight_kg, body_fat_pct — carry-forward sparse),
energy balance (intake_kcal, net_kcal), derived (recovery_score, consistency_score), bookkeeping
(per-day **goal snapshots**, rings_closed, **`source_flags` JSON** = measured|estimated|manual|absent).

`food_log` (one row per logged item): date, meal_type, name, qty, unit, calories, protein_g, carbs_g,
fat_g, fiber_g, sugar_g, sodium_mg, source (photo|barcode|voice|text|label), confidence, photo_uri,
created_at, editable.

`nutrition_goals`: calorie_goal, protein/carbs/fat targets, water_target, pace, **safe-clamped**
(calorie floor ≥ ~1200/day adult; deficit ≤ ~500/day; loss ≤ ~0.5–1 kg/wk).

`body_profile`: sex, birth_year, height_cm, weight_kg, activity_level, goal, gentle_mode flag.

`health_insights_log` / `streaks` / `personal_baselines` (rolling 14–90d mean/stddev per metric) /
`personal_records`.

---

## TDEE / net-calorie math (honest framing)
- BMR via **Mifflin-St Jeor** (Katch-McArdle if body-fat known). Active energy from HealthKit when
  present, else a steps→kcal estimate labelled "estimated".
- `TDEE = BMR + active_energy` (don't also multiply by an activity factor when active energy is
  measured — that's the common double-count bug; the multiplier is only a no-data fallback).
- Net = Intake − TDEE, shown as a **7-day rolling average** with ±15–25% honesty framing — a trend,
  never a daily verdict or moral score. **Fully toggleable; off-limits framing for ED safety.**

---

## Dr. Lucy guardian (engine + safety)
- **Rule catalog** (from research) as a typed table: activity, sleep, heart/recovery, nutrition,
  hydration, mood/correlations, weekly trends. Each = condition (vs personal baseline) → message →
  severity (gentle in-app card / one push nudge / rare warning).
- **Anti-noise:** ≤2 pushes/day, one per metric/day, ignore-streak backoff, no-repeat cooldowns,
  quiet hours / in-meeting / just-opened gating, per-category toggles + "gentle mode".
- **Cadence:** morning briefing, capped daytime nudges, silent post-meal cards, evening check-in,
  flagship **weekly report** (narrative, not a stat dump), rare real-time warnings.
- **SAFETY (non-overridable):** not a doctor/medical device; no diagnosis/prescription/test
  interpretation; onboarding + contextual disclaimers; **on-device red-flag classifier** (chest pain,
  breathing, stroke signs, suicidal ideation, etc.) that drops self-care advice and urges
  emergency/professional care + crisis resources; **ED-safe**: calorie floors, capped deficits, never
  gamify eating less, never moralize food, treat very-low intake as a *care* event, optional
  hide-numbers gentle mode.
- **LLM mapping:** deterministic engine passes the already-decided rule + safety flag; "Dr. Lucy"
  system prompt voices it (warm, observation-first, one suggestion, plain language); safety flag wins.
  Wire alongside `buildUserContextPrefix` in the ask pipeline.

---

## Phased plan (build-risk gated)

**Phase 0 — Decisions + native build gate.** Confirm vision provider (remote) + HealthKit binding +
camera/barcode deps; do a throwaway Codemagic build proving they compile & launch on New Arch. (Highest
risk first — same lesson as executorch/tcp-socket.)

**Phase 1 — Activity & Energy revamp (mostly JS, no/low native).** `daily_health` roll-ups from data we
already read; TDEE (needs a tiny body-profile onboarding); **activity rings (Move / Active-min / Mind) +
streaks with rest-day tokens**; net-calorie view (toggle, ED-safe); two flagship insights (sleep↔mood,
activity↔mood — inputs already exist); redesigned Health UI (rings, sparklines, weekly bars, streak
calendar heatmap). Mirror in `web/dashboard.html`.

**Phase 2 — Nutrition MVP (needs the native build).** Onboarding → TDEE + macro goals (safe-clamped);
daily intake dashboard (calories-remaining + macro rings + meal timeline); logging: **manual + voice +
text + barcode** first (on-device, reuse voice infra), then **photo→macros via remote vision** with an
editable correction loop + confidence; nutrition DB (USDA FoodData Central / Open Food Facts). Safety
floors enforced from day one.

**Phase 3 — Dr. Lucy guardian.** Rule table + on-device safety classifier + floors + LLM voicing +
notification cadence/controls + weekly report.

**Phase 4 — Depth.** Recovery readiness (HRV+RHR+sleep vs baseline), sleep stages, weight/body-comp +
Katch-McArdle, badges/PRs, home-screen widget, **Android Health Connect parity**, opt-in clinical/cycle.

## Critical findings discovered during planning
- **HealthKit is referenced but NOT installed.** `recordLifeContext.ts` does
  `require('@kingstinct/react-native-healthkit')` inside try/catch, but the package is **not in
  `package.json`** → the require throws and is swallowed → **sleep & resting-HR never populate today.**
  Only Pedometer steps (expo-sensors, installed) actually work. So the "minimal" Health tab is partly a
  missing-dependency bug. **Adding the dep + a Codemagic build is the real unlock** for sleep, HR, and
  active/resting energy — this is the native build gate, and it should come early.
- **LAN companion parity is mandatory.** Everything built for the app Health section must also appear in
  the `web/dashboard.html` LAN companion (served at :8088, hot-reloaded, bump its `dashboard rev N`
  marker). Build app + web together for each Health increment; the server API (`localServer`) must expose
  the new health/nutrition reads + write endpoints (log food, set goals) the web UI needs.

## Honest risks
- Native build risk (HealthKit/camera/barcode) — gate early.
- Calorie accuracy is ±15–25% on both sides — frame as trends, never precise truth.
- Health features are high-liability — the safety + ED guardrails are **requirements, not polish**, and
  must land with Phase 2.
- Remote vision = cost + privacy tradeoff — opt-in, confidence-routed, shield posture.
- Scope is large — ship Phase 1 (engaging activity side using data we already have) as the fast,
  low-risk win before the native-dependent nutrition work.
