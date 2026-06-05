# Progress

## 2026-05-25 - Phase 1 Bootstrap

Built an Expo SDK 56 React Native TypeScript app with:

- Text-only Capture screen designed for WhisperFlow keyboard input.
- Explicit transcript extraction preview before final save.
- Visible microphone placeholder that reports recording is coming later.
- Dashboard tabs for todos, ideas, expenses, places, and interests.
- `AIProvider` abstraction with `analyze`, `urgentScan`, and `summarize`; external AI is opt-in and private/local/offline requests route to Ollama without external fallback.
- Anthropic and Ollama provider implementations plus centralized extraction prompts.
- Sensitivity preflight and private-by-default enforcement for extracted ideas.
- Full requested SQLite schema and repository modules.
- SQLCipher configuration, SecureStore-held random database key, and fail-closed startup when encrypted SQLite is unavailable.
- On-device generic markdown vault initialization, append-only daily note writing, and content-driven project/area/person folder creation for non-private captures.
- Generic repository `vault/` placeholders and `web/` placeholder.
- README, environment example, and agent-memory folder.

Verified:

- `npm run typecheck` passes.
- `npm run test:phase1` passes with three Tanglish scenarios: normal expense/todo markdown rendering, and a startup idea forced private and excluded from markdown eligibility.
- `npx expo-doctor` passes all 21 project health checks and resolved config includes SQLCipher.
- Live provider validation identified retired Haiku configuration and updated the app to active Claude API defaults before rerunning.
- `npm run test:live-claude` passed for normal Tanglish todo and expense samples using active Haiku; the private idea sample was rejected by local preflight and never submitted.
- Re-ran `npm run typecheck`, `npm run test:phase1`, and `npx expo-doctor` on user request; all still pass and `.env.local` is absent from the workspace.
- Configured the existing Android SDK `platform-tools` in the user environment, started `emu01_master`, generated the native Android project, built and installed the SQLCipher-enabled debug APK, and launched the Phase 1 UI.
- Native launch verification confirmed `files/SQLite/lucy.db`, SecureStore state, and all generic on-device `files/vault/` base folders are created on startup without an encrypted-storage failure.
- Fixed two native-run blockers discovered during emulator testing: React Native Gradle plugin/Foojay incompatibility under Gradle 9.3.1 via a persistent `patch-package` patch, and React Native bundling failure from `@anthropic-ai/sdk` by moving the Claude adapter to the HTTP Messages API behind the same provider boundary.
- Replaced deprecated React Native `SafeAreaView` use with `react-native-safe-area-context`; the Capture UI now launches without that debug warning.

Not device-verified in this session:

- None of the outstanding Phase 1 persistence/privacy paths below remain unverified; they were exercised in the continued session entry.

## 2026-05-25 - Instant Inbox And Device Completion

Built:

- Replaced the blocking review/save/edit workflow with immediate ingestion: text is written to an encrypted capture queue, the composer clears immediately, and local analysis proceeds while more notes may be entered.
- Added capture states (`Queued`, `Organizing`, `Saved`, `Needs retry`), retry support, interrupted-processing recovery, and a queue wake-up guard for rapid back-to-back sends.
- Added append-only `extractions` snapshots and capture result metadata/migrations for already initialized databases.
- Normalized local LLM output against the extraction schema so malformed enum responses cannot corrupt UI/database contracts.
- Tightened the extraction prompt so ordinary daily planning is not treated as a novel private idea.
- Refreshed the Capture and Dashboard presentation with a conversational inbox, local/privacy badges, Memory summary cards, and simplified navigation.
- Added `npm run android:connect-local` and emulator testing instructions for Metro/Ollama reverse tunnels.

Verified:

- `npm run typecheck`, `npm run test:phase1`, and `npx expo-doctor` pass.
- Installed and ran Ollama `phi3` locally and routed the Android emulator to it via `adb reverse tcp:11434 tcp:11434`.
- Ran two captures through the Android UI while local processing was active: an ordinary expense/reminder showed immediate queue acknowledgement and progressed to `LOCAL Saved`; a sensitive startup/health idea was accepted while the first processed, progressed from `Queued` to `PRIVATE Saved`, and did not block further capture.
- Verified the ordinary capture wrote `files/vault/Daily/2026-05-25-1-Auto-Expense-Reminder.md`.
- Verified the private capture produced no additional `Daily`, `Projects`, or `People` markdown file.
- Verified Dashboard renders extracted tasks, one idea, and one expense with private/local badges.
- Did not retain either provider secret disclosed in chat; the completed device path used local Ollama only and both exposed keys must be rotated.

## 2026-05-25 - Share Intake, Today, And Local Reminders

Built:

- Added native incoming text-share support with `expo-sharing` configuration for Android `text/plain` and the iOS share extension configuration.
- Routed shared text directly into the encrypted processing queue and added database-backed ten-minute deduplication for repeated share-delivery events.
- Added automatic failed-capture retry scheduling and foreground queue wake-ups.
- Added local reminder notification setup and persistence of notification schedule IDs.
- Added deterministic parsing for explicit English reminder times (`tomorrow at ...` and full month/date/time input), including invalid date/time rejection; the model no longer owns those scheduling timestamps.
- Redesigned Dashboard as `Today` with `Now`, `Captured`, and `Library` surfaces, prioritizing scheduled reminders and showing reminders that still need a time separately.
- Applied clarified privacy semantics: private content remains visible in the encrypted app UI; only credential-like content is masked in previews and notification text. Private captures remain blocked from external AI and markdown output.
- Shortened local extraction prompts and normalized blank/malformed local-model results.

Verified:

- `npm run typecheck`, `npm run test:phase1`, and `npx expo-doctor` pass after the changes.
- Rebuilt and installed the Android development app with generated share-intent filters and notification permission/channel support.
- Exercised Android incoming share intake on the emulator through `SEND text/plain`; after database deduplication, sending the identical 12:00 PM share twice created one capture.
- Verified the fresh shared capture progressed to `Saved` and Today displayed the scheduled reminder at device-local `5/26/2026, 12:00:00 PM` without a notification-pending marker.
- Verified private startup/health content is readable in-app with a `PRIVATE` badge while remaining excluded from markdown.
- Benchmarked `qwen2.5:1.5b` against `phi3`: qwen was faster after warmup but misclassified ordinary English text and missed reminder extraction, so `phi3` remains the default for now.

## 2026-05-25 - LUCY Branding And Background Recovery

Built:

- Applied the official LUCY identity to app configuration and live UI: `LUCY`, `Listen / Understand / Connect / Yield`, dark surfaces, and warm orange accents.
- Updated user-facing completion language from `Saved` to `Remembered`; technical storage naming remains internal only.
- Corrected native Android generation so the application ID, label, and share target are `com.anonymous.lucy`.
- Added `expo-system-ui` for the dark native shell and `expo-background-task` for user-enabled opportunistic organizing.
- Added a first-launch background organizing consent prompt and a tappable `Local-first` / `Background on` header status pill.
- Registered an OS-managed background task only after consent; each background opportunity processes one queued thought to bound slow local inference.
- Removed manual retry as a required workflow. Failed processing now displays `Will retry`, automatically reattempts with backoff, and requeues previously stranded failed captures at startup.
- Corrected the bulk-input validation documents and script: they target `com.anonymous.lucy` and identify bulk submission as intake verification, not proof of completed extraction.

Verified:

- `npm run typecheck`, `npm run test:phase1`, and `npx expo-doctor` pass.
- Clean-regenerated and installed the Android native LUCY package after clearing stale generated references to the prior package name.
- Verified live Android UI renders LUCY branding and the background consent prompt; after choosing Allow, the header reports `Background on`.
- Verified automatic recovery end to end: removed the emulator Ollama tunnel, shared a thought, observed `Will retry` with no retry button, restored the tunnel, and observed the same thought become `Remembered` automatically.

## 2026-05-26 - LUCY Settings, Brand Assets, And Release Startup

Built:

- Created a warm-orange LUCY icon master and transparent Android adaptive foreground; configured native icon, web favicon, and the `lucy` app scheme. Retained a matching splash master for a later isolated native splash pass.
- Added a Settings view with background organizing control, OS-managed timing explanation, encrypted queue metrics, automatic retry messaging, latest recorded background activity, and clarified privacy behavior.
- Persisted background-task activity/result data and added an encrypted capture queue summary query.
- Refined the phone header layout so `Listen / Understand / Connect / Yield` remains legible without wrapping beside background status.
- Fixed bundled Hermes startup by initializing React Native's standard environment before Expo imports, preventing missing `FormData` and `AbortSignal` failures in release builds.

Verified:

- `npm run typecheck`, `npm run test:phase1`, and `npx expo-doctor` pass after implementation.
- Built and installed the Android release application from a short `C:\LucyMvp` junction, working around the Windows CMake path-length limit from the full workspace path.
- Confirmed the release app stays running and displays LUCY, its Settings view, background registration, automatic retry queue labels, and the private-data explanation.
- Confirmed the fixed release launch no longer logs the `FormData` or `AbortSignal` fatal startup failures observed before the bootstrap fix.

## 2026-05-26 - Native On-Device Intelligence

Built:

- Replaced laptop-backed local inference as the default with native `react-native-executorch` processing through the existing AI provider boundary; `ollama-dev` remains an explicit development override only.
- Added Settings setup/removal controls for downloaded local models and selected quantized `Qwen3 0.6B` as the fast tier (about 482 MB), with a configured balanced tier for later comparison.
- Raised native minimums required by ExecuTorch to Android 13 and iOS 17.
- Added JSON repair, a compact English-first local extraction prompt with an expense example, and an empty-extraction guard so blank local output becomes an automatic retry rather than a remembered thought.
- Added Qwen no-thinking instruction and a 75-second native generation interrupt so difficult thoughts cannot organize indefinitely.
- Updated README and environment defaults for phone-local inference and the Windows physical short-copy native build workflow.

Verified:

- `npm run typecheck`, `npm run test:phase1`, and `npx expo-doctor` pass.
- Built and installed a native Android release app containing ExecuTorch from `C:\LucyNativeBuild`; building from the long workspace fails at ExecuTorch CMake path lengths.
- Downloaded and loaded the Qwen fast model within the Android emulator through Settings, then removed/re-downloaded local model resources without removing captured memories.
- Removed `adb reverse tcp:11434`; only Metro ports remained while on-device testing ran.
- Submitted `Paid 17 dollars for soup today.` through Android share intake and verified it became `Remembered` and appeared in Expenses as `17 - paid for soup`, `NORMAL`, `food`.
- Submitted `Startup idea: build a private garden planning app named Fern.` and verified it completed under the bounded runtime and appeared in Ideas as `Fern - Private Garden Planning App` with a `PRIVATE` badge.
- Verified an incomplete local extraction no longer persisted as successful during testing; it transitioned to automatic retry. Private markdown exclusion remains covered by `test:phase1`.

## 2026-05-26 - Timeline Memory And Ask LUCY

Built:

- Added immutable capture timestamps to the visible Inbox and Today captured views, and changed markdown note timestamps to reflect original capture time rather than later processing time.
- Added linked completion updates for concise payment follow-ups (`Paid`, `Paid it`, `Payment is done`) against a recent prior payment task, preserving both timestamped captures as an audit trail.
- Prevented historical retry fragments from completing later tasks by enforcing forward-only, two-hour matching; new queued input is processed before due retries so stale background work cannot delay a fresh update.
- Added an encrypted `questions` table and an `Ask` tab. The first local-only intent answers questions about today's pending tasks and deadlines and records a local organization hint for future dedicated Today/work-arrival views.
- Added deterministic explicit-English handling for clear payment tasks, expenses, and decisions; added deterministic credential sanitization so secrets are not echoed in visible structured content.
- Added a non-persisting English local-model benchmark surface in Settings and a development-only model asset relay configuration; relay transfers public model assets only and does not move inference off-device.
- Replaced unsupported `Object.groupBy` timeline rendering with a Hermes-compatible reducer in Capture and Today views.

Verified:

- `npm run typecheck`, `npm run test:phase1`, and `npx expo-doctor` pass after the final edits.
- Built and installed the embedded-bundle Android APK from `C:\LucyNativeBuild`, avoiding any dependency on an incorrectly edited Metro bundle URL during final device testing.
- Verified on the Android emulator that `I need to pay the garden bill today.` is followed by a nested `Paid it.` event showing `Captured 5/26/2026, 11:25:58 AM` and `Completed 5/26/2026, 11:26:03 AM`.
- Verified an older failed `Paid it.` capture remains a separate retry and did not attach to the later garden task after chronology protection.
- Verified Ask LUCY answers the office-arrival question locally with pending tasks and today's deadline count, and renders `This question was remembered locally as a useful Today view pattern.`
- Ran the first seven-case device benchmark before deterministic fast paths: Qwen passed 5/7, with explicit expense and decision failures motivating the bounded English fast path. A post-fast-path full model benchmark remains pending because the local model asset was removed during APK storage management.

## 2026-05-26 - Persistent Ask Chat And Quiet Archiving

Built:

- Replaced the Ask form/result layout with a ChatGPT-style conversation surface: LUCY/user bubbles, a suggested first prompt, a fixed follow-up composer, and clearly labeled `LUCY ANSWER` cards.
- Added encrypted `ask_threads` and `ask_messages` storage. The active Ask thread and displayed answer snapshots restore after an app restart without re-running historical queries.
- Kept Ask mounted across in-app tab changes so the open conversation remains in place while consulting Today or Capture.
- Added non-destructive archiving for unmatched standalone completion fragments such as `Paid it.` when no earlier compatible payment task exists. Archived records remain encrypted and timestamped but leave the active retry/feed surfaces.
- Added startup cleanup for previously failed ambiguous completion fragments and surfaced an `Archived` queue metric in Settings.

Verified:

- `npm run typecheck`, `npm run test:phase1`, and `npx expo-doctor` pass.
- Installed the updated embedded-bundle Android APK and verified old standalone `Paid it.` retry noise disappears from Inbox while legitimate linked completion events remain displayed under their original tasks.
- Verified Settings reports `0` items in `Will retry` and `2` locally archived historical fragments in the retained emulator database.
- Asked the office-arrival question, entered a follow-up (`What deadlines do I have for today?`), force-closed/reopened LUCY, and verified the follow-up question and its `Today at a glance` response restore in the Ask thread.

## 2026-05-26 - Ask Result Integrity Cleanup

Built:

- Added conservative cleanup for clearly misclassified structured results: standalone completion/payment statements are not active todos, and paid-expense statements are not deadlines.
- Added `archived_at` and `archive_reason` fields to todo/reminder rows so invalid derived items can leave current retrieval without deleting original captured memory.
- Made Ask answer rendering explicit with `Pending Tasks (n)` and `Deadlines Today (n)` blocks and empty-state text.
- Applied the same invalid-artifact filter to restored Ask snapshots so earlier bad model output does not remain visually presented as active current work.

Verified:

- `npm run typecheck`, `npm run test:phase1`, and `npx expo-doctor` pass.
- Built a smaller emulator-only `x86_64` APK after the full multi-ABI APK could not be staged due emulator storage limits; installed it without removing LUCY memory.
- Verified against the retained polluted emulator database that Ask changed from showing `Paid`, `paid 17 dollars for soup today`, and `Paid 500 dollars for breakfast today.` as work/deadline artifacts to showing `1 pending task and 0 deadlines for today`.
- Verified `Buy Coffee` now appears visibly within `Pending Tasks (1)`, not under deadlines.

## 2026-05-26 - Context Enrichment And Obsidian Knowledge Map

Built:

- Added encrypted `context_requests` storage with answered/open state, timestamped answer text, reason, and priority.
- Routed model-provided clarifications into that queue and turned unmatched shorthand completion updates into optional clarification prompts rather than recurring retries or speculative links.
- Added a `Context` lane inside Today, including a Needs Context summary prompt and a local-only `Remember context` response flow.
- Added append-only Obsidian projection notes under `vault/Memory/Connections` for newly processed non-private memories. These notes wiki-link daily thoughts and extracted project/area/person/interest concepts so Obsidian graph view can display LUCY connecting knowledge.
- Documented the architecture boundary: encrypted SQLite is canonical memory; markdown is a visible, non-private projection; daily intelligence comes from retrieval, provenance, clarification, and later organization rather than silently retraining model weights.

Verified:

- `npm run typecheck`, `npm run test:phase1`, and `npx expo-doctor` pass; tests now cover connection-note wiki-link formatting while existing private-vault exclusion remains enforced.
- Built and installed an embedded-bundle Android `x86_64` APK over the retained encrypted emulator database.
- Verified startup converts two retained unmatched completion fragments into `2 memory details could become clearer`, and Today's `Context` lane shows the associated question.
- Submitted context for one historical test fragment and verified the open Needs Context count changed from `2` to `1` without deleting or rewriting timeline memories.
- Submitted `I need to pay the design invoice today.` and verified it became Remembered and wrote `files/vault/Memory/Connections/2026-05-26-18-Pay-the-design-invoice-today.md` with a wiki-link to its Daily memory.

## 2026-05-26 - Ask Clean Start And Conversation History

Built:

- Changed Ask navigation so leaving the tab unmounts the visible conversation; returning always starts from a clean new-chat surface.
- Added a `History` control listing encrypted past threads by their first question, latest activity time, and message count.
- Added explicit historical-thread selection and `New chat` controls. Selected histories can receive follow-up questions, but are never reopened automatically.
- Create a thread only after a question is submitted, avoiding empty history entries from merely opening Ask.

Verified:

- `npm run typecheck`, `npm run test:phase1`, and `npx expo-doctor` pass.
- Built and installed the embedded Android `x86_64` APK without clearing the retained encrypted memory database.
- Verified Ask initially displays only a clean welcome/suggestion composer plus `History`, with no previous answer bubble.
- Verified History lists the stored office-arrival thread and selecting it restores its prior questions and answers.
- Verified switching from the selected historical thread to Today and back to Ask returns to a blank new-chat state rather than displaying the prior conversation.

## 2026-05-26 - Encrypted Memory Map And Conservative Organizer

Built:

- Added encrypted derived-memory tables for `knowledge_entities`, `knowledge_connections`, `knowledge_insights`, and `organization_runs`.
- Implemented a deterministic organizer that rebuilds its projection from latest completed extraction snapshots, answered Context prompts, and recognized Ask patterns, without modifying original captured thoughts.
- Added evidence-based confidence labels: one observation is `emerging`, two are `supported`, three or direct user clarification are `confirmed`.
- Integrated organization into startup, successful foreground processing, OS-permitted background work, answered clarification, and Ask signal recording.
- Added `Today > Memory`, showing organization summaries, learned signals, derived connections with explanations, and known topics.
- Added a bounded explicit-English project relationship path (`Project <name> involves <person> in <area> area.`) for reliable local connection capture and demonstration.

Verified:

- `npm run typecheck`, `npm run test:phase1`, and `npx expo-doctor` pass; focused tests cover confidence accumulation and privacy escalation in the derived graph.
- Installed the embedded Android `x86_64` APK over retained encrypted app data.
- Verified Memory initially reported `12 remembered thoughts into 0 entities, 0 connections, and 2 insights`, accurately displaying the previously supplied clarification and confirmed repeated Today-view request without inventing entity links.
- Captured two explicit Horizon/Sam/Marketing memories and verified both became `Remembered` without model delay.
- Verified Memory then reported `14 remembered thoughts into 3 entities, 3 connections, and 2 insights`; displayed `Horizon involves Sam`, `Horizon belongs to area Marketing`, and `Marketing includes Sam`, each as `supported` from two remembered thoughts.

## 2026-05-26 - Manual Re-organization And Calm Memory UI

Built:

- Added a local `Re-organize now` Settings action. A one-tap `Run` rebuilds derived knowledge immediately, while a small information sheet explains the privacy and scheduling behavior.
- Added encrypted derived `structured_text` for captures, generated from extraction results while preserving each original raw thought and timestamp. Organizer runs backfill earlier remembered thoughts.
- Added an optional `View structure` expansion in `Today > Captured`, keeping the default list peaceful while revealing readable project/area/action structure on demand.
- Added deterministic English capture support for scoped work-project tasks and scoped Ask retrieval, so `Tasks related to ofc today` limits results to stored work context.
- Removed ordinary privacy text badges from memory and Ask result cards; private memory uses only a small lock cue, while ordinary memory is unmarked.
- Refactored Settings from long descriptive cards into a single-view control list with status summaries and `i` detail sheets.

Verified:

- `npm run typecheck`, `npm run test:phase1`, and `npx expo-doctor` pass.
- Built the embedded Android `x86_64` APK from `C:\LucyNativeBuild` and installed it over retained encrypted emulator data.
- Confirmed all six Settings controls fit together without scrolling; opened the `Re-organize now` explanation sheet and manually changed the latest organization trigger to `manual`.
- Confirmed the retained map remains evidence-based: `17` remembered thoughts, `5` entities, `4` connections, and `2` insights.
- Confirmed a remembered office item has no ordinary privacy label by default, expands via `View structure`, and displays `Project: Data Platform | Area: Ofc work` plus its action.
- Confirmed Ask returns `3 pending tasks related to ofc and 0 deadlines for today` with the dbt/Snowflake, ADF, and Python/shell tasks and no privacy text badge clutter.

## 2026-05-26 - Ask Memory Map Retrieval With Sources

Built:

- Expanded Ask LUCY beyond today's task listing so a named project, area, or person can be queried directly from the encrypted Memory Map.
- Added deterministic memory-question recognition and conservative `office` / `ofc` normalization for the previously captured work context.
- Added Memory answer cards showing evidence-backed connections, confidence, number of supporting thoughts, and timestamped source memories with extracted actions.
- Kept the feature local and inspectable: answers query derived encrypted SQLite memory and extraction evidence rather than requesting an external model response.
- Updated clean-start Ask wording so users can discover project, area, and person questions without reopening history.

Verified:

- `npm run typecheck`, `npm run test:phase1`, and `npx expo-doctor` pass; tests cover memory-question recognition and the `office` / `ofc` normalization.
- Built and installed the embedded Android `x86_64` APK from `C:\LucyNativeBuild` over the retained encrypted emulator database.
- Asked `What Data Platform memory` and verified a local `LUCY MEMORY` answer containing three timestamped dbt/Snowflake, ADF, and Python/shell supporting thoughts plus the confirmed `Data Platform belongs to area Ofc work` connection.
- Asked `Who connected to Horizon` and verified two supported connections, `Horizon involves Sam` and `Horizon belongs to area Marketing`, each grounded in two remembered thoughts.
- Asked `What office work keeps repeating` and verified it resolved to `Ofc work`, returned the Data Platform connection, and cited the three stored work actions.
- Confirmed the final installed APK opens Ask as a clean new session with guidance to name a project, area, or person to explore connected memory.

## 2026-05-26 - Outcome Evaluation, Journal Models, And Reprocessing

Built:

- Added a 100-case outcome catalog across ten LUCY outcomes, with sixty ordinary synthetic cases eligible for local-versus-Claude comparison, twenty LUCY memory-workflow cases, and twenty local-only idea/privacy cases.
- Added a Claude safe-comparison runner that deliberately excludes protected and confidential fixtures from network calls.
- Added local monthly payment insight handling in Ask so `Summary of my payments this month?` produces category/payment memory instead of an empty task/deadline answer.
- Changed Memory answer presentation from timestamped supporting-storage language to quieter remembered context while retaining internal provenance.
- Added a runtime local-model catalog and encrypted selection for `Qwen3 0.6B`, `Qwen3.5 0.8B`, `Qwen3.5 2B`, `Qwen3 4B`, and `Phi-4 Mini 4B`, matching the installed ExecuTorch registry.
- Added `Reprocess all memories`: it preserves raw thoughts, cancels generated scheduled reminders, clears generated interpretation, requeues original memories, and rebuilds with the selected model. It refuses to start while interpretation is already active.
- Extended deeper model interpretation windows up to five minutes, matching the user's journal-first quality preference.

Verified:

- `npm run typecheck`, `npm run test:phase1`, `npm run test:outcome-catalog`, and `npx expo-doctor` pass.
- Outcome catalog validation confirms exactly `100` test cases over `10` outcomes and `60` remote-safe model-comparison cases.
- Built and installed the updated x86_64 emulator APK containing the model selector, chose `Qwen3.5 2B`, restarted LUCY, and verified that the encrypted selection persisted. Full-memory reprocessing remains intentionally unexecuted until a benchmarked model is selected.
- Claude A/B execution is prepared but intentionally not run because no rotated Anthropic key is configured locally; the previously disclosed chat token must not be reused.

## 2026-05-26 - Eleanor Longitudinal Benchmark Intake

Built:

- Isolated the provided `kaggle_dataset.zip` under `benchmarks/kaggle-eleanor/raw/`, outside LUCY's live encrypted memory database.
- Added a benchmark README describing intended longitudinal-memory use, local-only safety constraints, and the user-confirmed MIT license.
- Ignored the source ZIP, extracted raw JSON, and future result files from version control to prevent accidental publication of protected benchmark content.
- Added `npm run test:kaggle-eleanor`, which validates the local corpus shape and protected-content lane without printing diary text or sending it to a model.

Verified:

- Parsed `1,460` daily records from `December 1, 2020` through `November 30, 2024` and `50` manual-injection probes.
- Confirmed daily records contain chronological task, completed-yesterday, and journal sections suitable for memory/organization testing.
- Confirmed the corpus includes password-shaped testing facts, health, and relationship content. The user clarified the passwords are made up; the lane remains local-only by default so it can verify that LUCY protects secret-shaped memory.
- `npm run typecheck`, `npm run test:phase1`, `npm run test:outcome-catalog`, `npm run test:kaggle-eleanor`, and `npx expo-doctor` pass.

## 2026-05-27 - Local Versus Claude Eleanor Scorecard

Built:

- Added a sanitized Eleanor oracle-memory model runner for local Ollama candidates and stored only score/timing metadata in ignored benchmark results.
- Added a chronological timeline retrieval runner, keeping the Eleanor memory sequence separate from the user's app database.
- Added an experimental Claude benchmark route that uses local `phi3` to identify password-shaped values before outbound requests, with deterministic redaction as a fail-safe.
- Parameterized the remote runner to compare `claude-haiku-4-5-20251001` and `claude-sonnet-4-6` on the same synthetic benchmark and documented both local and redacted-remote commands.
- Published the aggregate scorecard in `benchmarks/kaggle-eleanor/COMPARISON_REPORT.md` without exposing generated answers or substituted secret values.

Verified:

- Oracle-memory result: Claude Sonnet 4.6 scored `45/50` at `91.3%` coverage and `2.17s` average; Claude Haiku 4.5 scored `41/50` at `88.7%` coverage and `1.06s` average.
- Local oracle-memory result: `phi3` scored `26/50` at `68.2%` coverage and `10.20s` average; `qwen2.5:1.5b` scored `13/50` at `42.6%` coverage and `2.91s` average.
- `qwen3.6` is installed in Ollama but is not runnable on this laptop: it requested `24.3 GiB` available memory while approximately `12.5 GiB` was available during the check, so it is excluded from quality rankings.
- The full Claude run included the fifty synthetic probes by user direction; one password-shaped probe passed through local `phi3` redaction before remote calls, with the deterministic backup retained.
- Chronological retrieval baseline found the targeted injected memory in the top five for only `9/50` probes, identifying retrieval quality as the next core bottleneck.
- `npm run typecheck`, `npm run test:phase1`, `npm run test:kaggle-eleanor`, `npm run test:outcome-catalog`, and `npx expo-doctor` pass around this benchmark work.

## 2026-05-27 - OpenAI Eleanor Benchmark Lane Prepared

Built:

- Added `tests/kaggle-eleanor.openai-redacted.ts` and `npm run bench:kaggle-eleanor:openai` for the same fifty-probe oracle-memory evaluation through the OpenAI Responses API.
- Configured the lane for current general-purpose comparison tiers: `gpt-5.4-nano`, `gpt-5.4-mini`, `gpt-5.4`, and `gpt-5.5`.
- Reused the benchmark protection flow: local `phi3` identifies password-shaped values before remote processing and deterministic redaction remains as a fail-safe.
- Documented `OPENAI_API_KEY` as local benchmark configuration only and added the pending OpenAI rows/commands to the Eleanor report and README.

Verified:

- `npm run typecheck`, `npm run test:phase1`, `npm run test:kaggle-eleanor`, `npm run test:outcome-catalog`, and `npx expo-doctor` pass after the OpenAI lane addition.
- Confirmed the user supplied an OpenAI key in local development form as `EXPO_PUBLIC_OPENAI_API_KEY`; the benchmark runner now accepts that compatibility alias while docs prefer `OPENAI_API_KEY`.
- Stopped the interrupted chronological `phi3` runner processes after their completed `9/50` retrieval-only result had already been written, preventing unnecessary local inference load.

Executed:

- Ran a two-probe OpenAI Responses API smoke comparison successfully across `gpt-5.4-nano`, `gpt-5.4-mini`, `gpt-5.4`, and `gpt-5.5`.
- Ran all `50` Eleanor oracle-memory probes through all four OpenAI models after the same local `phi3` password redaction and deterministic fail-safe used for Claude.
- Results: `gpt-5.4-nano` scored `41/50` (`86.0%`, `1.18s` average), `gpt-5.5` scored `34/50` (`77.4%`, `1.46s`), `gpt-5.4-mini` scored `27/50` (`68.4%`, `1.09s`), and `gpt-5.4` scored `26/50` (`70.0%`, `1.17s`).
- Recorded the completed cross-provider table in `benchmarks/kaggle-eleanor/COMPARISON_REPORT.md`. The unexpectedly strong Nano score is treated as exact-short-answer performance, not a claim that it is universally the best memory model.

## 2026-05-27 - Hybrid GPT Nano Beta And Android Phone APK

Built:

- Switched the product remote lane to OpenAI `gpt-5.4-nano` through the existing provider boundary and added encrypted, per-device OpenAI key entry under `Settings > Remote intelligence`.
- Added a Capture composer option, `Contains private details`, and stored that user choice durably on the encrypted capture so full-memory reprocessing cannot silently remove it.
- Added the protected-remote experiment: when remote intelligence is enabled for a protected thought, the selected on-device model must produce placeholder-only sanitized text before GPT Nano is called; a failed mask falls back to local processing. Deterministic password/card masking remains as an additional guard.
- Updated Settings and README language to state the beta boundary honestly: original private thoughts remain local; placeholder processing is experimental and testers should use fake private values.
- Configured hybrid EAS profiles with no embedded API key and created a credential-free Android ARM64 APK at `dist/LUCY-android-beta-hybrid-arm64.apk`.

Verified:

- `npm run typecheck`, `npm run test:phase1`, `npm run test:kaggle-eleanor`, `npm run test:outcome-catalog`, and `npx expo-doctor` pass.
- A live ordinary expense smoke call through the app's GPT-5.4 Nano adapter succeeded without logging token contents.
- Built the Android phone APK from isolated `C:\LucyHybridBetaBuild` with all `.env*` files excluded; scanned its packaged content against local OpenAI/Anthropic key values and found no bundled credential.
- Confirmed the phone APK contains `arm64-v8a`; it is v2 signed for sideload testing with the Android debug certificate, not a Play Store release signature.
- Built and installed a separate key-free `x86_64` release APK on the emulator. Verified the visible `Contains private details` control and the secure `OpenAI API key` entry sheet with `Save key and turn on`.
- Confirmed EAS is not logged in on this laptop; iOS TestFlight generation requires the user's Expo login plus Apple Developer/App Store Connect signing access.

## 2026-05-27 - Android Tester Usability Repair

Built:

- Made each Settings row itself open its detail sheet, so configuration no longer depends on discovering the small `i` button.
- Added Android keyboard-aware composer lifting for Capture and Ask, keyboard-aware Settings detail sheets, hidden upper chrome while typing, and Android resize configuration.
- Rebuilt the credential-free ARM64 tester APK at `dist/LUCY-android-beta-hybrid-arm64.apk`.

Verified:

- `npm run typecheck`, `npm run test:phase1`, and `npx expo-doctor` pass.
- Installed the updated x86_64 APK on the emulator and verified full-row Settings targets including `Open Remote intelligence`; tapping the row body opens the key-entry sheet.
- Verified the Settings API-key field raises from y=1274 to y=287 while the emulator keyboard is active.
- The emulator exposes only a floating keyboard strip for Capture/Ask, so the full-keyboard composer repair requires confirmation on the Android phone where the original overlap appeared.
- Built the final ARM64 APK in isolated `C:\LucyHybridBetaBuild`; confirmed it contains only `arm64-v8a`, is v2 signed for sideload testing, and contains zero matches for the two local API secret values scanned.

## 2026-05-27 - Android Keyboard Focus Hotfix

Built:

- Removed the app-level keyboard re-layout that unmounted header/navigation while a text field was focused.
- Removed Android JavaScript translation of focused Capture and Ask composer bars; Android now uses native `adjustResize`, avoiding focus loss when the keyboard appears.
- Added explicit Remote intelligence setup language: the field accepts an OpenAI API key only and the current remote model is GPT-5.4 Nano.
- Published the replacement tester APK at `dist/LUCY-android-beta-hybrid-arm64.apk`.

Verified:

- `npm run typecheck`, `npm run test:phase1`, and `npx expo-doctor` pass.
- Installed an equivalent signed x86_64 hotfix on the emulator over retained app data.
- Capture input remained focused at both one second and five seconds after opening the keyboard; Ask input passed the same one-second and five-second checks.
- Settings renders `OpenAI API key only`, `GPT-5.4 Nano`, and the instruction not to enter Claude or other provider tokens.
- The published ARM64 APK is aligned and v2 signed with the same sideload certificate as the prior beta update path, contains only `arm64-v8a`, and has no matches for the two local API secret values scanned.
- Published APK SHA-256: `A48AD63611E7C152F87E48D60C14B58EE5BF00490DFE68672856CC2F68ACAF18`.

## 2026-06-05 - Mixed-Language Listen Transcription Fix

Built:

- Corrected build 1.0.136 language preferences so English + Telugu uses automatic transcription-language detection instead of forcing unsupported `language=te`.
- Added a documented-language allowlist for single-language Whisper hints.
- Added a one-time automatic retry without the language hint when OpenAI rejects a hint as unsupported.
- Reset the per-session language hint before profile loading and clarified the Settings explanation for mixed-language speech.
- Replaced deprecated, New-Architecture-incompatible `@react-native-voice/voice` with `expo-speech-recognition@56.0.0`.
- On-device mode now requests microphone permission directly, verifies recognition and true on-device support, requires local processing, preserves Telugu as `te-IN`, and surfaces structured native errors instead of silently looping.
- Added the SDK 56 speech-recognition config plugin and advanced native build numbers to iOS `1.0.87` / Android `42`.

Verified:

- `npm run typecheck` passes.
- Focused transcription-language tests pass for English + Telugu, Telugu-only, Hindi-only, normalized duplicates, and unsupported-language retry detection.
- `npm run test:phase1` is currently blocked before assertions by the plain-Node runner loading Expo/React Native without its runtime globals.
- `npx expo config --type public` resolves the new speech-recognition plugin and iOS microphone/speech permission strings.
- `npx expo-doctor` passes all 21 checks after migrating splash configuration and aligning SDK 56 patch versions.
- The replacement requires a new native iOS/Android build; it cannot be verified on an iPhone from this Windows workspace.
