# Core Logic Audit — MVP-grade weak links (2026-06-17)

Four parallel read-only audits of the core logic (capture→memory→knowledge-graph, ask/insights,
voice/scheduling, DB/cross-cutting). Goal: find MVP placeholder logic not fit for a real product —
regex doing the LLM's job, magic thresholds presented as intelligence, full-table rebuilds/scans,
fabricated stats, silent `catch{}`, and (worst) **irreversible auto-deletes on the user's memory**.

Status legend: ✅ fixed · 🔜 staged (safe, do next) · ⚠️ needs device test / sign-off.

## 🔴 HIGHEST: self-heal/cleanup layer makes irreversible DELETE/merge decisions (data loss)
- ⚠️→✅ **`stalenessEngine.archiveIgnoredDuplicates`** (stalenessEngine.ts:463-493, run at :530) — auto-archives a "duplicate" todo after 7 days, "loser" chosen by string length. Duplicate flag is uncalibrated Jaccard (DUP 0.82 / KEYWORD 0.72 / jaccard 0.60). FIX: don't auto-archive; leave for user. (SAFE)
- ⚠️→✅ **`cleanupJunkPeople`** (people.ts:18-57) — hard `DELETE` of anyone matching a hardcoded brand regex (`nokia|google|apple…`) or sharing ≥2 name tokens with the user (deletes family members!). FIX: stop destructive delete (only blank names), or soft-archive. (SAFE)
- ⚠️→✅ **`decayStaleOpenLoops`** (openLoops.ts:43-50) — bulk-resolves open loops >30 days purely by age. A second brain must not silently forget. FIX: don't auto-resolve; surface for review. (SAFE)
- ⚠️→✅ **`decayStaleLearnedFacts`** (learnedProfile.ts:157-163) — DELETEs emerging facts unseen 45 days. FIX: decay confidence, don't delete. (SAFE)
- ⚠️ **`dedupLearnedFacts` + `upsertLearnedFact` similarity** (learnedProfile.ts:35-41,79,137-154) — overlap-coefficient over `min(|a|,|b|)` @ 0.52 over-merges short distinct facts + hard-deletes; corrupts the user model injected into every prompt. FIX: symmetric Jaccard + same-category gate + soft-delete. (moderate — pure logic, testable)
- 🔜 **`insertTodo` META_TASK_RE** (todos.ts:18-23,72) — silently DROPS tasks matching a regex (e.g. "design…layout") with no archive/trace. FIX: insert + auto-archive (recoverable). (SAFE)

## 🟠 HIGH: correctness
- ✅ **`computeStart` weekday support** (commandRouter.ts:45) — "next Tuesday" silently booked as TODAY (LLM only emitted today/tomorrow/ISO). FIXED: resolves weekday names + updated prompt + tests.
- ⚠️ **Embedding model mismatch silently kills semantic recall** (vectorSearch.ts:117) — offline keyword-256 vs remote openai-512; on offline→remote upgrade, all old embeddings skipped → Ask silently answers from "last 20 notes". FIX: search per-model bucket + lazy re-embed + dev-log warning. (moderate, needs offline→remote device test)
- ⚠️ **Regex intent routing** (askIntent.ts whole file; ask.ts:539-551) — scheduling/spending/memory-map/LLM branch chosen by keyword lists; misroutes natural phrasing. FIX: LLM intent classifier + regex fast-path w/ confidence. (moderate)
- 🔜 **Spending scope defaults all-time** (askIntent.ts:21-25) — "last week" returns all-time total. FIX: parse window + label scope honestly. (SAFE)
- 🔜 **`answerMonthlySpending` full-table read** (ask.ts:120) — `listExpenses` then JS filter. FIX: push date filter to SQL. (SAFE)
- ⚠️ **Voice "task" raw INSERT** (commandRouter.ts:155-167) — single tasks bypass extraction (lose deadline/urgency/category); comma heuristic arbitrary. FIX: run classify/parseDeadline or route through extraction. (moderate, async UX)
- 🔜 **Bare-hour am/pm** (classify.ts:42-47) — "meet at 2" can book 2 AM. FIX: daytime default. (moderate)

## 🟠 HIGH→MED: credibility (fabricated "intelligence")
- ✅ **organizer "connected the dots" notification** — already replaced with grounded actionable insight (commit d9c7b63).
- 🔜 **Health insights fabricated stats** (healthInsights.ts:122-179) — "improves cognition ~15%", universal thresholds (sleep ≥8, HR <60) as if personalized. FIX: baseline-relative, drop invented stats. (SAFE)
- 🔜 **deviceStats fabricated defaults** (deviceStats.ts:92-93) — topHour→9, topDay→Monday when no data → new user told "most active Monday 9am". FIX: return null, suppress. (SAFE)
- ⚠️ **Knowledge-graph relation verbs are fiction** (organizer.ts:53-62) — co-occurrence pair → fixed verb by type ("Apollo involves Sam"). FIX: neutral "related to" or LLM-typed relations. ((a) SAFE)
- ⚠️ **confidence `evidenceCount===3`** ladder (organizer.ts:49-51) — "3 mentions = confirmed" arbitrary + brittle equality. FIX: recency/day-spread/salience + crossed-threshold diff. (moderate)

## 🟡 MED: scalability (full-table scans / rebuilds — fine now, bad at scale)
- ⚠️ **Knowledge graph full DELETE+rebuild on every trigger** (organizer.ts:188-246 + knowledge.ts:88) — runs on foreground, startup, after delete, 4× per Ask; reads ALL extractions, O(n²) co-occurrence, wipes entity IDs. FIX: incremental, debounced, UPSERT by natural key. (moderate, core path)
- ⚠️ **vectorSearch loads ALL embeddings + parses per query** (embeddings.ts:101, vectorSearch.ts:99-138) — O(N) per Ask, no ANN. FIX: FTS/recency pre-filter, cache parsed vectors. (moderate)
- 🔜 **Missing indexes** (init.ts) — todos(status,archived_at), reminders(status,remind_at), expenses(*none*), scheduled_blocks(status,start_at,end_at). FIX: additive `CREATE INDEX`. (SAFE)
- 🔜 Various daily self-heals are O(n²) full-table (dedupePendingTodos, recategorizeExpenses, etc.) — bound to recent rows. (SAFE)

## 🟡 MED: quality
- ⚠️ **`bm25Score` constant fake IDF** (vectorSearch.ts:43 `Math.log(1.5)`) — defeats BM25 rare-term weighting. FIX: real doc-freq or rename to TF. (SAFE)
- ⚠️ **`entityScore` = every Capitalized word** (vectorSearch.ts:53-76) — "I/Monday/The" become entities; deviceNer exists but unused. FIX: use deviceNer/people table. (moderate)
- ⚠️ **Ad-hoc timezone parsing in 30+ files** (the `includes('T') ? x : …+'Z'` pattern) — mixed UTC/local conventions feed delete/recurrence logic; off-by-hours near midnight/DST. FIX: one `parseDbTimestamp/toDbTimestamp` helper + one convention. (moderate, broad)
- 🔜 **Three separate date parsers** (stalenessEngine.extractScheduledDate, reminderTime, temporalEngine) miss "next Monday/noon/explicit dates" + drop timezone. FIX: consolidate (chrono-node). (moderate)
- 🔜 **`detectsCaptureIntent` hijacks questions** (ask.ts:269-272) — "do you remember that meeting?" saved as a capture. FIX: exclude interrogatives. (SAFE)
- 🔜 **`detectRecurrence` misses "every Monday"/monthly** (classify.ts:59-64) — common routine dropped to one-off. FIX: weekday-name → weekly DOW anchor. (moderate)
- 🔜 **`commitSeries` dedup on exact title** (scheduling/index.ts:170) — title drift double-books a routine. FIX: dedup by time+resource. (moderate)
- 🔜 **end-conversation regex false-trigger** (conversation.ts:24) — "I'm done with the report, schedule…" ends convo. FIX: anchor/length-gate. (SAFE)

## 🟢 Observability (cheap, makes everything else debuggable)
- 🔜 **Pervasive silent `catch{}`** (extract.ts ~11 sites, organizer, ask.ts:250/301/518, insightEngine:122, userProfile:21, schedule.ts:97, recordLifeContext, healthInsights) — failures invisible to user AND dev. FIX: route through existing `logError`/`insertDevLog`; keep non-fatal. (SAFE)

## Cross-cutting theme / recommended principle
**Convert every auto-DELETE/merge in the self-heal layer to soft-archive-with-review.** That single
principle de-risks most HIGH findings cheaply. Calibrate or remove magic constants. Prefer the LLM
(already in the pipeline) over keyword regex for classification/relations; keep regex only as a
zero-latency fast-path with a confidence gate. Push filters into SQL; make silent catches observable.
