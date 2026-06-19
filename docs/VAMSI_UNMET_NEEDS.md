# What LUCY Still Doesn't Solve For Me (Vamsi)

> First-person brainstorm by "agent Vamsi" — grounded in my real data (work: Genie/Databricks,
> Snowflake, dbt, Alation, Tidal pipelines, AD-groups/Azure work, office submissions; people:
> Monisha, Priya, Raghavendra, family; side project: CineBuddy; ~$5.2k tracked spend, rent +
> insurance + cloud subs; mood swings between stressed/low/calm; a lease/move and Chicago travel).
>
> NOTE: the LAN companion at 192.168.1.68:8088 was unreachable when I wrote this (phone off Wi-Fi /
> app closed), so this is reasoned from the repo memory files + docs + my known data, not a live pull.
>
> Scope rule: every idea below is something LUCY does NOT already do. I deliberately skipped what
> exists (capture, timeline, transcription, extraction, brain/KG, Ask router, conflict-free calendar,
> tasks, reminders + alarms, health/calories/Dr. Lucy/meds, expenses, vault, people, projects +
> autopilot, privacy shield, LAN companion, learned profile, gallery).
>
> Effort: S = OTA-only / a day or two · M = a feature week · L = multi-week or needs new subsystem.

---

## ⭐ MY TOP 6 (build these first)

1. **Commitment & deadline guardian for work submissions** — *why first:* my notifications are mostly
   high-priority office submissions and deadlines; right now LUCY reminds me an item EXISTS but never
   tells me "you said you'd send the Alation lineage doc to Raghavendra by Thursday and you haven't
   touched it." A deadline that LUCY actively chases is the single thing that would save me from
   dropped balls at work.
2. **Email / Slack / Teams intake (read-only "AI inbox")** — *why first:* 80% of my dropped balls
   start in an email or a Teams ping I never turned into a task. LUCY can't see any of it, so I'm the
   manual bridge. This is the biggest "I wish it just handled this" in my day.
3. **Relationship keep-warm nudges (Monisha, Priya, family)** — *why first:* LUCY KNOWS these people
   and the last time I mentioned them, but it never says "you haven't talked to Priya in 3 weeks."
   It's the cheapest emotional-load win and it's already half-built (People + learned profile + mood).
4. **Money that watches itself (recurring/subscription + budget drift)** — *why first:* I log
   expenses but LUCY never warns me a subscription renewed, a bill is due, or I'm over for the month.
   ~$5.2k tracked and zero foresight. Private, on-device, no Plaid — just pattern detection on what I
   already log.
5. **Move / lease / errand project that runs itself** — *why first:* the move is a real multi-step
   thing (notice date, deposit, movers, address changes, utilities) and it lives in my head, not in
   LUCY. Project autopilot exists for work clusters; this is the same engine pointed at life admin.
6. **Energy-aware day planning (not just conflict-free)** — *why first:* the calendar avoids clashes
   but ignores that I'm fried by 4pm. It already has my mood/energy history — it should refuse to
   schedule deep Snowflake work into my low-energy slots and protect my actual good hours.

---

## Work & Career

### Commitment & deadline guardian *(TOP 6 #1)*
- **Problem:** I tell people "I'll get you X by Friday" in meetings and captures, and LUCY files it as
  a note or a vague reminder. It never tracks the *promise* — who I owe, what, by when — or escalates
  as the deadline nears with "this is at risk."
- **Wish:** LUCY extracts commitments ("I'll send…", "I owe…", "by EOD/Thursday") into a tracked
  obligations list with owner + due date, then chases me proportionally to urgency and surfaces
  "at-risk" ones first.
- **Why it matters:** my notifications are dominated by office submissions/deadlines — this is the
  failure mode that actually costs me at work.
- **Effort:** M · **Backend/native:** no (extraction + reminders infra already exist).

### Email / Slack / Teams intake *(TOP 6 #2)*
- **Problem:** my real to-dos are born in email and Teams. LUCY is blind to all of it; I'm the manual
  copy-paste bridge, and that's exactly where things slip.
- **Wish:** a read-only "AI inbox" — connect Gmail/Teams, LUCY surfaces "these 3 need a reply / became
  a task / mention a deadline" without me forwarding anything.
- **Why it matters:** closes the #1 source of dropped balls; it's also the headline competitor gap
  (Saner/Mem parity) in our own comparison doc.
- **Effort:** L · **Backend/native:** yes (OAuth + a token broker; clashes with no-backend stance —
  needs the Phase-2 proxy decision).

### Standup / status-update generator
- **Problem:** every standup and weekly update I reconstruct "what did I do" from memory. LUCY has my
  entire captured week (Genie pipeline work, dbt models, Tidal jobs) and never offers to summarize it.
- **Wish:** "what did I do this week" → a clean, shareable bullet status pulled from my captures,
  commits-of-thought, and completed tasks, grouped by project.
- **Why it matters:** recurring weekly chore, and the data is already sitting in the timeline.
- **Effort:** S · **Backend/native:** no.

### Work-context briefs before meetings
- **Problem:** I walk into a meeting about Alation or AD-group migration and have to re-load context
  myself. LUCY has the prior notes but doesn't assemble them for the moment.
- **Wish:** when a calendar event matches a known project/person, LUCY pre-builds a one-card brief:
  last decisions, open loops, what I promised, related docs in the vault.
- **Why it matters:** I context-switch across Snowflake/Databricks/Alation all day; the reload tax is
  real.
- **Effort:** M · **Backend/native:** no (calendar + KG + vault all exist).

### Learning / skill backlog with nudges
- **Problem:** I keep capturing "should learn X" (a dbt pattern, a Databricks feature) and they die in
  the timeline. No follow-through loop.
- **Wish:** LUCY collects my learning intents into a tiny backlog and occasionally proposes a 30-min
  slot for one when my calendar + energy allow.
- **Why it matters:** career growth is the thing that's always last; passive nudging is exactly LUCY's
  job.
- **Effort:** S · **Backend/native:** no.

## Money & Finance

### Money that watches itself *(TOP 6 #4)*
- **Problem:** I log expenses but LUCY is purely a ledger. It never says "your cloud subscription
  renews tomorrow," "rent is due," "you're $300 over your usual eating-out this month," or "this looks
  like a duplicate charge."
- **Wish:** on-device pattern detection over what I already log — recurring/subscription detection,
  bill-due forecasting, month-over-month drift alerts, anomaly flags. No Plaid, no bank login.
- **Why it matters:** ~$5.2k tracked and zero foresight; the foresight is the whole point of a second
  brain.
- **Effort:** M · **Backend/native:** no.

### Reimbursement & owed-money tracker
- **Problem:** I front money (shared dinners, the AC unit, travel) and lose track of what's owed to me
  or what I can expense at work.
- **Wish:** tag an expense as "owed by Monisha" / "work-reimbursable," and LUCY tracks the open
  balance and reminds me to collect/submit.
- **Why it matters:** small amounts I genuinely forget and never recover.
- **Effort:** S · **Backend/native:** no.

### Goal-based saving / big-purchase planning
- **Problem:** the move + travel are big lumpy costs and I have no sense of runway against them.
- **Wish:** set a goal ("$2k for the move by Aug"), LUCY tracks progress from my logged spend/income
  signals and tells me if I'm on pace.
- **Why it matters:** turns anxiety into a number; ties money to the move project.
- **Effort:** M · **Backend/native:** no.

## Relationships & Social

### Keep-warm nudges *(TOP 6 #3)*
- **Problem:** LUCY knows Monisha, Priya, Raghavendra and when I last mentioned each, but never
  prompts me to reach out. People silently go cold.
- **Wish:** per-person "last contact" + a gentle, human nudge ("you usually check in with Priya more
  than this") with a one-tap "remind me to message her."
- **Why it matters:** lowest-effort, highest-emotional-payoff feature; the data already exists.
- **Effort:** S · **Backend/native:** no (People + mention timestamps already there).

### Important-date & gift memory
- **Problem:** birthdays, anniversaries, "Monisha's exam is next week" — I capture them once and they
  evaporate.
- **Wish:** LUCY lifts dates/life-events tied to people into recurring quiet reminders and even
  suggests a gift idea from past notes about them.
- **Why it matters:** these are the misses that actually hurt a relationship.
- **Effort:** M · **Backend/native:** no.

### "Remember this about them" recall before I talk to someone
- **Problem:** I forget that Raghavendra mentioned his kid was sick, or what Priya said she was
  stressed about — context that makes me a better friend/colleague.
- **Wish:** before a call/meet with a person, LUCY surfaces "last 3 things you noted about them" so I
  pick up where we left off.
- **Why it matters:** it's the difference between transactional and thoughtful.
- **Effort:** S · **Backend/native:** no.

## Health, Energy & Mental Load

### Mood → action loop (not just logging)
- **Problem:** I have 150+ mood entries swinging stressed/frustrated/low, but LUCY just records them.
  It never connects "you're low three days running and you've been doing back-to-back Snowflake work
  with no breaks."
- **Wish:** LUCY correlates mood with my actual week (workload, sleep, last social contact) and offers
  ONE concrete intervention, gently.
- **Why it matters:** the data's there; right now it's a diary, not a guardian.
- **Effort:** M · **Backend/native:** no.

### Sleep & recovery awareness
- **Problem:** late-night pipeline debugging wrecks my sleep and LUCY doesn't know or care; the
  HealthKit sleep read is still partly stubbed.
- **Wish:** once HealthKit sleep is live, LUCY ties poor sleep to my next day ("rough night — want me
  to lighten today's plan?") and protects a wind-down window.
- **Why it matters:** sleep is the upstream lever for the mood swings above.
- **Effort:** M · **Backend/native:** yes (deeper HealthKit read — already a known gap).

### Hydration / movement / break micro-nudges on desk days
- **Problem:** on heavy build days I sit for hours, skip water and lunch (the app even noticed
  partial meal logging).
- **Wish:** light, learned-pattern nudges ("you've been heads-down 2h — stretch?") only on detected
  desk-bound days, never naggy.
- **Why it matters:** small, compounding, and fits the passive-companion identity.
- **Effort:** S · **Backend/native:** no.

## Home, Move & Errands

### Move / lease / errand project that runs itself *(TOP 6 #5)*
- **Problem:** the move is a real multi-step project (lease notice, deposit, movers, address changes,
  utilities transfer, internet) and none of it is structured — it's anxiety in my head.
- **Wish:** LUCY recognizes the move from my captures, spins up a checklist project with the standard
  steps + sensible dates, and walks me through it.
- **Why it matters:** the highest-stakes life-admin thing happening to me right now, and it's pure
  dropped-ball territory.
- **Effort:** M · **Backend/native:** no (project autopilot + calendar exist).

### Errand batching by location/time
- **Problem:** I accumulate "pick up X," "drop off Y," "call Z" and do them inefficiently or forget.
- **Wish:** LUCY groups errands and proposes "you'll be out Saturday — knock out these 3 together."
- **Why it matters:** reclaims scattered time without me planning it.
- **Effort:** M · **Backend/native:** partial (location grouping is nicer with geo, but doable without).

## Travel

### Trip co-pilot (Chicago and beyond)
- **Problem:** my Chicago travel lives as scattered notes — flight, hotel, who I'm seeing, what I
  wanted to do — with no single view, no countdown, no pre-trip checklist.
- **Wish:** LUCY clusters trip captures into a trip card: dates, bookings from the vault, a packing
  list, people to see there, and reminders (check-in, leave-for-airport).
- **Why it matters:** travel is high-context and time-pressured; today I reassemble it manually each
  time.
- **Effort:** M · **Backend/native:** no (vault + calendar + people + reminders compose this).

## Learning, Side Projects & Growth

### CineBuddy (and side-project) momentum keeper
- **Problem:** CineBuddy ideas land in the timeline and stall; LUCY doesn't treat my side project as a
  living thing with momentum or next actions.
- **Wish:** a dedicated side-project mode that gathers all CineBuddy captures, surfaces the next 1-2
  concrete steps, and nudges weekly so it doesn't die.
- **Why it matters:** side projects only survive on consistent small pushes — exactly what a passive
  assistant should provide.
- **Effort:** M · **Backend/native:** no (projects + autopilot exist; this is a focused mode).

## Admin & Bureaucracy

### Document expiry & renewal watch
- **Problem:** my vault has IDs, insurance, lease, visa/work docs — LUCY stores them but never warns me
  one is about to expire or needs renewal.
- **Wish:** LUCY reads expiry dates from vault docs (OCR already there) and quietly reminds me ahead of
  renewals.
- **Why it matters:** an expired document is a high-pain, easily-prevented miss.
- **Effort:** M · **Backend/native:** no (vault + OCR + reminders exist).

### Decision / loose-end resolver
- **Problem:** I have a pile of open loops ("decide on the apartment," "reply to the recruiter") that
  the app even counts (~200 open loops at one point) but never helps me actually CLOSE.
- **Wish:** LUCY periodically presents ONE stale open loop as a "still relevant? decide now / drop it"
  card so decisions don't rot.
- **Why it matters:** open loops are pure background mental load; closing them is the relief.
- **Effort:** S · **Backend/native:** no (open_loops + the review-card deck already exist).

## Time, Energy & Focus

### Energy-aware day planning *(TOP 6 #6)*
- **Problem:** the calendar is conflict-free but energy-blind. It'll happily drop deep Snowflake work
  into my 4pm crash window because the slot is technically open.
- **Wish:** LUCY uses my mood/energy history to build an energy curve and schedules demanding work in
  my good hours, light/admin work in the dips.
- **Why it matters:** I have the data (mood + energy tones); this is the upgrade that makes the
  calendar feel like it actually knows me.
- **Effort:** M · **Backend/native:** no (mood/energy + scheduler exist; it's a scorer enhancement).

### Weekly review ritual
- **Problem:** I never step back. There's no moment where LUCY and I look at the week — what got done,
  what slipped, what's coming.
- **Wish:** a Sunday "let's review" card: wins, dropped commitments, money snapshot, next-week
  heads-up — auto-assembled, two minutes to skim.
- **Why it matters:** the habit that makes every other feature pay off; Sunsama's whole moat is this
  ritual.
- **Effort:** M · **Backend/native:** no.

---

## How to read this
Top 6 are the highest "I wish it just handled this" wins grounded in my actual life. Of those, #1, #3,
#4, #5, #6 are all OTA-able with existing subsystems (no backend/native) — the only heavy one is #2
(email/Slack intake), which needs the backend/OAuth decision we've already flagged in the monetization
and competitor docs.
