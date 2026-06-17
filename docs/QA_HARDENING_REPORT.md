# QA / Hardening Report — 2026-06-17 (overnight)

Local, deterministic hardening of Lucy's pure engines (no DB/native/LLM needed). Run all with
`npx tsx tests/<name>.ts`.

## Baseline suite (pre-existing) — all green
| Suite | Result |
|---|---|
| `tests/calendar.ts` (conflict-free scheduling engine) | 25 passed, 0 failed |
| `tests/shield.ts` (privacy shield tokenization) | all assertions passed |
| `tests/learnedProfile.ts` | all assertions passed |
| `tests/outcome-catalog.validation.ts` | 100 cases across 10 outcomes |

(`tests/phase1.ts` requires the native/DB runtime, not a pure test — skipped here.)

## New this session
| Suite | Result | Covers |
|---|---|---|
| `tests/reminders.ts` (NEW) | 28 passed, 0 failed | Recurring-reminder rule detection + next-occurrence math (month-end clamp, weekend skip, year rollover, catch-up after missed cycles) |
| `tests/hardening.ts` (NEW) | 28 passed, 0 failed | Adversarial date/scheduling/resource invariants (below) |

## What the hardening pass asserts (and confirmed correct)
- **Date parsing (`parseDeadline`)**: empty/gibberish → null; today/tonight/eod → today 23:59 local;
  tomorrow → +1 day; "by <weekday>" → the correct *future* weekday; same-weekday-as-today → next
  week (never today). Boundary-correct.
- **Interval overlap (`overlaps`)**: touching intervals `[0,10)`&`[10,20)` do NOT overlap (correct
  half-open semantics); contained/disjoint/reverse-order/zero-width all behave correctly.
- **Resource conflict model (`canCoexist`/`normalizeResources`)**: two focus blocks conflict; two
  "you"/self blocks conflict; passive+anything coexists; a location implies the `self` axis; the
  relation is symmetric.
- **Recurrence detection (`detectRecurrence`)**: daily/weekdays/weekly/none classified correctly.

## Known limitation (documented, not a bug)
- `parseDeadline` is a deliberately small heuristic — it does NOT parse "next week", explicit dates
  ("June 20"), or clock times. That's by design: the LLM extraction supplies precise ISO times
  upstream; `parseDeadline` is only a cheap fallback for the common today/tomorrow/by-weekday phrases.
  Flagging here so nobody mistakes it for a parser regression.

## Net
No defects found in the pure date/scheduling/resource core — it's well-behaved under adversarial
input. The two new suites lock in that behavior so future edits can't silently break it. Total local
coverage now: **calendar 25 + reminders 28 + hardening 28 + shield + learnedProfile + outcome 100**.

> Note: this is *local pure-logic* hardening. On-device behavior (notification scheduling, HealthKit,
> the LAN website, the full extraction LLM path) still needs device/website verification — pending the
> user being back online with the app + companion open.
