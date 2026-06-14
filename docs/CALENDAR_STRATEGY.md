# LUCY Intelligent Calendar — Strategy (v1, 2026-06-14)

## The idea (in the user's words)
1. A calendar/timetable that is **foolproof and completely evident**.
2. **Conflict invariant:** *no two tasks that cannot be done in parallel may sit at the same
   calendar time.* (Tasks that CAN run in parallel — e.g. "laundry running" + "reply to email" —
   are allowed to overlap.)
3. LUCY **intelligently suggests the perfect time slot** for any new work, based on **calendar
   availability + personalization** (energy, routines, preferences).

This is the long-parked "Daily Timetable / schedule manager" backlog item, now with a precise spec.

---

## 1. Core principle — resources, not vibes
The conflict rule must be **deterministic and explainable**, never a fuzzy per-decision LLM guess.
So we model every block on the timeline by the **exclusive resources** it consumes. Two blocks may
overlap **iff their exclusive-resource sets are disjoint.**

```
canCoexist(A, B)  ⇔  exclusiveResources(A) ∩ exclusiveResources(B) = ∅
```

The LLM's only job is to **classify a task's resources once** (at capture/extraction). The scheduler
then enforces conflicts with pure set logic — auditable, testable, and identical every time.

### Exclusive resources — FULL AXES (locked decision #1)
| Resource | Meaning | Example holders | Conflict rule |
|---|---|---|---|
| `focus` | conscious attention (the scarcest) | deep work, meeting, writing, studying | two `focus` ⇒ conflict |
| `self` | one body, in-person presence | any in-person errand/appointment | two `self` ⇒ conflict |
| `location:<x>` | must be physically at place `x` | gym, office, clinic, commute | two locations that **differ** ⇒ conflict (same place OK); holding a location implies `self` |
| `voice` | mouth/ears engaged | phone call, stand-up, recording | two `voice` ⇒ conflict |
| `hands` | hands engaged | cooking, driving, repairs | two `hands` ⇒ conflict |

`canCoexist(A,B)` = false if they share any binary axis (`focus`/`self`/`voice`/`hands`) **or** both
have a `location` and the locations differ; otherwise true.

**Passive/background tasks hold NO exclusive resource:** laundry running, a file downloading, bread
proving, "drink water." They overlap anything.

Worked combos:
- deep work `{focus}` + commute-on-train `{self, location:train}` → share nothing → **parallel OK**
  (only because the classifier said the work doesn't need `self`; if it does, default makes it conflict).
- call `{voice, focus}` + walk `{self}` → disjoint → **parallel OK** (call while walking).
- call `{voice, focus}` + meeting `{voice, focus, self}` → share `voice`+`focus` → **conflict**.
- gym `{self, location:gym}` + grocery `{self, location:store}` → share `self` (and locations differ)
  → **conflict**.

### Foolproofing the richer model
More axes = more to classify, so each is **assigned conservatively** and carries a confidence:
- The classifier emits each axis independently; **any low-confidence axis defaults to present** (more
  exclusive), and a fully-unknown task defaults to `{focus, self}`. We never under-constrain.
- `focus`/`self` are the dominant axes — most real conflicts resolve there even if `voice`/`hands`
  are mislabeled, so a wrong `voice` guess can't cause a *missed* clash, only a missed *parallel*
  opportunity (the safe direction).

### The conservative default = foolproof
If LUCY is unsure what a task needs, it defaults to `{focus, self}` (treat as exclusive). We would
rather *not* double-book than wrongly allow a clash. **Fail safe toward exclusive.** This is what
makes the invariant trustworthy: unknowns never silently overlap.

Examples:
- "Write the design doc" `{focus}` + "Reply to Sam" `{focus}` → **conflict** (two focus blocks).
- "Write the design doc" `{focus}` + "Laundry" `{}` → **parallel OK**.
- "Gym" `{location:gym, self}` + "Call mom" `{voice}` → resources disjoint → **technically parallel**
  (you can call from the gym) unless the user marks calls-need-focus.
- "Dentist" `{location:clinic, self}` + "Standup" `{focus, voice}` → **conflict** (both need `self`).

---

## 2. The unified plan (timeline)
The day is one timeline carrying two kinds of blocks:
- **Fixed events** — from the device calendar (meetings, appointments). Immovable. Treated as
  `{focus, self}` + `location` if they have one, unless tagged "free/tentative."
- **Scheduled task-blocks** — todos that LUCY has placed into a time slot (its own calendar events,
  tagged `LUCY`). Movable unless the user pins them.

Plus **non-schedulable regions**: sleep window, protected routines (morning routine, meals, gym),
and per-day working hours. These are personalized (see §4) and block scheduling like busy time.

---

## 3. Task attributes (extracted once, refined by learning)
Each todo gains scheduling metadata (LLM-suggested at extraction, user/learning-correctable):
- `duration_min` — estimate (category default → corrected from actual completions).
- `resources` — the exclusive-resource set (§1). Drives conflicts.
- `energy` — `deep | shallow | passive` (deep ⇒ wants a peak-energy window).
- `location` — required place, or none.
- `time_window` — soft constraint ("morning", "after work", "9–5 only").
- `deadline` — hard due time, if any.
- `depends_on` — must follow another task (no scheduling before its prerequisite finishes).
- `fixed_at` — semi-fixed time the user stated ("call at 6") → near-pinned.
- `splittable` — can be chunked across multiple slots, or atomic.
- `priority` — from urgency + deadline pressure.

---

## 4. Personalization model (where "perfect slot" comes from)
Sources LUCY already has:
- **Learned profile** — wake time (~7:45), routines, "defers follow-ups," work-style facts.
- **Energy curve** — derived from the existing `mood_entries` (tone + energy) by time-of-day, plus
  *when tasks actually get completed* (completion timestamps already in `todos`). Builds a per-user
  "sharp vs low" profile across the day → deep work lands in peak windows.
- **Habit patterns** — observed batching ("admin after lunch", "gym 6pm"), same-location grouping.
- **Explicit preferences** — working hours, quiet/family/no-work windows, max focus hours/day,
  desired buffer between blocks.

All on-device; nothing leaves the phone.

---

## 5. Slot-finding algorithm (the suggestion engine)
Given a new task `T`:
1. **Profile** `T` (§3): resources, duration, energy, location, window, deadline, deps.
2. **Build free/busy** over the horizon (now → deadline, else next N days): subtract fixed events,
   protected routines, sleep, out-of-working-hours.
3. **Generate candidate slots** = continuous gaps long enough for `T` where:
   - `T`'s exclusive resources are free for the whole span (no overlapping block shares one), AND
   - location is reachable (enough travel/transition buffer if the prior block is elsewhere), AND
   - within `T.time_window` and after all `depends_on` finish, AND
   - leaves the configured buffer before/after neighbouring blocks.
4. **Score** each candidate (personalization):
   - energy match (deep work ↔ peak window) — biggest weight
   - habit/routine alignment ("you usually do this kind of thing then")
   - deadline safety (comfortably before due, not last-minute, not needlessly early)
   - context batching (cluster similar tasks; cluster same-location)
   - low fragmentation / fewer context switches
   - respects quiet prefs (hard filter, not just score)
5. **Suggest** the top 1–3 with a **plain-English rationale**:
   *"Tomorrow 9:00–10:00 — your sharpest focus window, calendar's clear, and well before the 2pm
   deadline."*
6. **On accept** → create a real calendar event (`Calendar.createEventAsync`, tagged `LUCY`) +
   mark the todo `scheduled`. The user can edit/drag; LUCY re-validates.

---

## 6. The foolproof guarantee (hard invariant + validator)
- **Placement guard:** the scheduler never places a block into a slot that violates `canCoexist`
  with any time-overlapping block. (It literally can't generate such a candidate.)
- **Continuous validator:** a background sweep scans the whole plan; for every pair of overlapping
  blocks it asserts `canCoexist`. If the user manually adds a clashing calendar event (or two fixed
  events collide), LUCY **surfaces the conflict explicitly** and proposes a re-slot — it never hides
  it. "Completely evident" = every block shows the resource it holds and why it's placed there.
- **Conservative classification** (unknown ⇒ exclusive) means the invariant is never silently broken.

---

## 7. Dynamics / re-planning
When a new fixed event lands, a task overruns, or a deadline moves:
- Keep fixed events and **pinned/locked** task-blocks.
- Re-flow the remaining flexible blocks (a small constraint re-solve), preserving the invariant.
- If everything no longer fits before deadlines → **explicit overcommitment report**: "These 3 can't
  fit before Friday — shorten, move, drop, or delegate?" Never silently overflow or double-book.

---

## 8. Surfaces
- **Ask Lucy:** "When should I do X?" / "Plan my day" → suggestion(s) + rationale + one-tap accept
  (reuses the existing `proposedActions` approve-flow in `lucyActions`).
- **Today / Timetable view:** a vertical day timeline (app Brain tab + web `:8088`), fixed vs
  LUCY-scheduled distinguished, resource tags visible, drag to move (re-validates), conflicts flagged
  in red with a fix suggestion.
- **Morning brief / nudges:** "Here's today's plan" + proactive "now's your focus window for X."

---

## 9. Phased, de-risked rollout
- **Phase 0 — Engine (pure logic, no writes):** data model + resource classifier + `canCoexist` +
  free/busy builder + slot scorer. Fully unit-testable; prove the invariant with tests. Zero risk.
- **Phase 1 — Suggestion (read-only):** "best time for X" in Ask + a proposed-day preview. No calendar
  writes → safe to ship via OTA.
- **Phase 2 — Commit + view:** accept → create calendar event; Today timetable view; conflict
  validator + re-slot proposals.
- **Phase 3 — Auto-plan + learning:** "plan my whole day," dynamic re-planning, and self-correcting
  duration/energy estimates from actuals.

---

## 10. Foolproofing / edge cases to honour
- **Timezones & travel** (the user travels): schedule in current local tz; detect tz changes and
  re-anchor. Flag events that cross a tz boundary.
- Overcommitment → explicit, never silent overflow (§7).
- All-day events (don't treat as busy by default), multi-day/splittable tasks, recurring events.
- DST, midnight/sleep-window crossings.
- **User always wins:** LUCY proposes, user disposes. Optional "auto-apply once you trust me" mode.
- Tentative/free calendar events shouldn't block focus the way Busy ones do.
- Privacy: 100% on-device, consistent with LUCY's model.

---

## Locked decisions (2026-06-14)
1. **Parallel model = FULL AXES** from day one: `focus`, `self`, `location`, `voice`, `hands` (see §1),
   with conservative defaults so the extra precision can never cause a *missed* conflict.
2. **Autonomy = suggest + confirm.** LUCY always proposes a slot with a reason; nothing is written to
   the calendar until the user accepts. (An optional auto-apply mode is a later, opt-in setting — not
   built in the first cut.)
3. **Availability = hybrid (infer + correct).** LUCY infers working hours + protected windows (sleep,
   meals, gym) from behaviour + learned profile, **shows them in a confirmation step**, and lets the
   user edit any that are wrong. No mandatory setup; accuracy improves over time.
4. **Scope = both.** Schedule the todos LUCY already extracts AND honour ad-hoc "find time for <x>"
   requests (which create a schedulable task on the fly).

### What these imply for the build
- The resource classifier must output all five axes + per-axis confidence (Phase 0).
- Every commit path goes through an explicit accept step (Phase 2); no silent calendar writes.
- Add an "availability inference + confirm" onboarding card, re-confirmable from settings (Phase 1/2).
- Ask Lucy must turn "find time to learn Spanish" into a transient schedulable task (Phase 1).
