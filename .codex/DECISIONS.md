# Architecture Decisions

## 2026-05-25

- Kept Phase 1 text-only. No audio recording, Whisper integration, VAD, scheduling, or Share Sheet implementation was added.
- Superseded: the initial review-before-save flow was replaced by an immediate encrypted capture queue after UX testing showed capture should never wait on local analysis or a save/edit confirmation.
- Implemented Ollama immediately because the Phase 1 privacy contract cannot route private captures without a local provider implementation.
- Enabled SQLCipher and derived a random database key stored in SecureStore. Startup fails when SQLCipher is unavailable rather than storing private content in plaintext.
- Private classification applies to the complete capture: a capture containing an idea is SQLite-only and produces no markdown note.
- Runtime vault uses `expo-file-system` under application documents; repository `vault/` directories document the generic initial shape only.
- Set active official Claude defaults while allowing environment overrides: `claude-haiku-4-5-20251001` for normal extraction and `claude-sonnet-4-6` for future summaries. This replaces retired/deprecated initial snapshot IDs found during live validation.
- Kept direct Claude SDK use as prototype-only validation plumbing. Bundling API credentials in a distributed mobile app is not acceptable.
- Disabled external AI by default. `EXPO_PUBLIC_ALLOW_EXTERNAL_AI=true` is an explicit prototype opt-in for normal captures; private/local captures still cannot use Claude.
- Replaced `@anthropic-ai/sdk` with a direct `fetch` adapter for the Anthropic Messages endpoint because the installed SDK imports Node-only `node:fs` and fails Metro bundling on React Native. Business logic still uses only `AIProvider`.
- Added a persistent `patch-package` adjustment to `@react-native/gradle-plugin@0.85.3`, upgrading `org.gradle.toolchains.foojay-resolver-convention` from `0.5.0` to `1.0.0` so Expo SDK 56's Gradle 9.3.1 native build can run.
- Materialized the generated Android native project during native emulator verification; this is required locally to build the SQLCipher-enabled development app.
- Store incoming text immediately in encrypted SQLite, then process it in an in-app FIFO queue. The capture experience stays available while local LLM work is slow, and failed captures remain retryable.
- Preserve each processed structured result in an append-only `extractions` table to support future reclassification/reorganization as models improve without losing what was originally inferred.
- Normalize untrusted LLM JSON before persistence; models may return schema label strings or invented categories even when prompted with an enum contract.
- Use `adb reverse` for development-only access from the emulator to local Ollama and Metro; no localhost exception is assumed for physical device deployment.

## 2026-05-25 - Intake And Reminder Sprint

- Interpret `private` as a data-boundary flag: private content cannot be sent to external AI or markdown/sync, but remains openly readable within the encrypted app UI. Only credential-like values require masked app previews and neutral notification bodies.
- Use app-owned local notifications for captured reminders; LUCY does not create or modify device Alarm app alarms.
- Accept text share payloads directly into the existing queue and deduplicate identical Android/iOS shared content for ten minutes in SQLite, because native share payloads can be delivered again after reloads.
- Parse explicit English reminder timestamps deterministically on-device and use model output for reminder meaning only; scheduling cannot depend on a local model's timezone/date formatting.
- Keep `phi3` as the local extraction default after `qwen2.5:1.5b` ran faster but incorrectly privatized ordinary purchase/reminder text and omitted required extraction fields.

## 2026-05-25 - LUCY Branding And Background Work

- Adopt `LUCY` as the product and visible app name, expanded as `Listen / Understand / Connect / Yield`; use a calm dark palette with restrained orange emphasis.
- Present completed ingestion as `Remembered`, not `Saved`, because user memories should not be described like document storage operations.
- Move Android native package/share identity to `com.anonymous.lucy`; preserve the separately installed older prototype package during validation rather than deleting its test data.
- Offer background organizing as explicit user opt-in. Use `expo-background-task`, which delegates battery-friendly scheduling to Android WorkManager/iOS BGTaskScheduler; do not promise exact charging or nighttime execution.
- Bound each OS background opportunity to one capture because local inference can be slow and background execution windows are limited.
- Retry failed processing automatically with backoff and display `Will retry`; manual retry is no longer part of the primary LUCY experience.

## 2026-05-26 - Observability And Native Release Startup

- Display queue and background-organizing state in Settings from encrypted local data; record the last background result only when the operating system actually runs LUCY's task.
- Use the generated LUCY icon and Android adaptive foreground immediately, while retaining the coordinated splash master without enabling a custom splash plugin until native launch handoff can be tested independently.
- Initialize `react-native/Libraries/Core/InitializeCore` before importing Expo in `index.ts`, because the Expo SDK 56 bundled release runtime reads network globals before they were available under this Hermes startup path.
- Use a short Windows junction (`C:\LucyMvp`) during Android release validation because native CMake intermediate paths exceed Windows path limits from the full workspace directory; this is a build-environment workaround, not product behavior.

## 2026-05-26 - On-Device Model Runtime

- Route local/private analysis to `react-native-executorch` by default, preserving `AIProvider` as the only business-logic boundary. Keep Ollama available only through explicit `EXPO_PUBLIC_LOCAL_INFERENCE=ollama-dev` for development comparison.
- Use quantized `Qwen3 0.6B` as the fast device tier after the smaller LFM2.5 350M model failed to produce usable JSON extraction during emulator validation. Retain a larger configured tier for accuracy benchmarking, not as a proven default.
- Require user-triggered model preparation in Settings before automatic queue processing downloads hundreds of megabytes. A cached model may load automatically on subsequent app launches.
- Treat normalized empty model results as failed processing and retry them automatically; a thought must not become `Remembered` only because malformed model output can be normalized.
- Interrupt device generation after 75 seconds and request Qwen no-thinking JSON output, because one private idea otherwise occupied inference for more than two minutes.
- Supersede the junction release workaround for ExecuTorch builds: its CMake sources resolve to the full `node_modules` path. Use a physical `C:\LucyNativeBuild` copy until the repository path or build tooling is improved.

## 2026-05-26 - Timeline And Questions

- Treat each captured text as an immutable, timestamped event. Later organization may link events, but it must not silently rewrite or delete the original memory.
- Link a short completion only forward in time to a recent existing compatible task. The first implementation limits payment completions to a two-hour window; older failed retry fragments cannot consume newer tasks.
- Prioritize fresh queued captures over due automatic retries. Immediate user feedback and follow-up continuity take precedence while stale failures continue in background opportunities.
- Store Ask LUCY questions as encrypted local query signals, separate from captured thoughts. Asking for information must not become a new task or memory item, but repeated intent can guide future overnight views.
- Answer the initial today-task/deadline question through deterministic SQLite retrieval, with no AI or internet call required.
- Use deterministic English fast paths only for explicit facts with low ambiguity and retain the local model for richer interpretation.
- Avoid platform runtime assumptions such as `Object.groupBy` until Hermes support is verified; use compatible collection logic for device UI paths.

## 2026-05-26 - Persistent Chat And Archive Semantics

- Store Ask conversations and displayed answer snapshots in encrypted SQLite. Restoring a chat must not re-run prior queries or spend additional local inference work.
- Keep one active Ask thread for the current MVP; a future thread browser/new-chat workflow should be added before creating multiple unseen histories.
- Preserve ambiguous short inputs in encrypted archive rather than deleting them or repeatedly retrying them. Historical events remain available to an overnight organizer, while the active feed and processing budget remain clean.
- Archive only narrowly recognizable unmatched completion fragments automatically today. Broader LLM-assisted archive/reorganization decisions require overnight context and correction support before activation.

## 2026-05-26 - Derived Artifact Integrity

- Original captured thoughts are immutable history, but derived todos/reminders may be archived when their shape proves they were categorization errors, such as a recorded payment misfiled as pending work or a deadline.
- Filter invalid derived artifacts both at active retrieval and while rendering saved answer snapshots. Preserving the historical assistant answer in storage does not require continuing to show known-wrong active items to the user.
- Keep ordinary tasks such as `Buy Coffee` active unless completion or contrary context exists; do not hide valid work merely because surrounding test data was noisy.

## 2026-05-26 - Context Enrichment And Showable Memory

- Keep encrypted SQLite as the canonical memory layer for captures, timelines, relationships, corrections, clarification answers, confidence, and future organization. Obsidian markdown is a readable projection, not the database LUCY reasons from.
- Store voluntary clarification in encrypted `context_requests` linked to the originating capture. Ambiguous input should ask for help when the user is free instead of guessing or rewriting the original memory.
- Generate append-only `Memory/Connections` markdown only for non-private captures. These pages provide a demonstrable Obsidian wiki-link graph while respecting the rule that private memory cannot leave protected app storage.
- Treat day-by-day intelligence as memory retrieval and reorganizable derived knowledge, not automatic on-device weight training. This preserves provenance and makes user correction meaningful; any future fine-tuning must be a separate explicit opt-in design.

## 2026-05-26 - Ask Session Visibility

- Persist Ask conversations encrypted on device, but do not automatically display the last thread when the user returns to Ask. A clean entry state supports a new question without exposing prior conversation content on screen.
- Require an explicit `History` action and thread selection to reopen prior messages. Selecting a thread permits follow-ups in that thread; leaving Ask clears only the visible selection, not stored history.
- Avoid creating empty conversation rows when Ask is opened but unused; create a stored thread when the user submits its first question.

## 2026-05-26 - Inspectable Memory Organization

- Build the intelligence layer as an encrypted derived projection over immutable captures, not as untraceable model weight updates. Derived entities/connections may be rebuilt; captured events remain history.
- Use repeated, separately stored evidence for confidence: a one-off extracted relationship is `emerging`, two observations are `supported`, and three are `confirmed`. A direct context answer is shown as a confirmed user-provided signal, not auto-parsed into unverified links.
- Run the organizer deterministically on meaningful local events and OS-permitted background opportunities. Do not claim exact overnight execution until mobile scheduling conditions are implemented and verifiable.
- Keep this increment in SQLite and the app's Memory map. The existing non-private markdown projection remains available, but further Obsidian work is deferred after the user chose to focus on the core intelligence layer.

## 2026-05-26 - Derived Structure And Progressive Disclosure

- Preserve raw captured thoughts as the audit timeline and store a derived structured representation separately. Re-organization may regenerate derived text without rewriting what the user originally said or when it was captured.
- Let the user initiate local organization immediately with `Re-organize now`; background organization remains opportunistic because the operating system owns charging/idle scheduling windows.
- Keep privacy semantics visible without dominating the UI: ordinary entries show no label, private entries may show a quiet lock, and credentials remain masked.
- Present Settings as compact status/action rows. Longer explanations, permission details, and queue diagnostics belong in optional information sheets so the primary view remains calm and scan-friendly.

## 2026-05-26 - Cited Memory Retrieval In Ask

- Answer questions about a named organized project, area, or person through deterministic encrypted SQLite retrieval from the Memory Map and extraction evidence. This does not require internet access or another model generation.
- Display connections with confidence and timestamped supporting thoughts so users can inspect why LUCY answered, rather than receiving unsupported narrative conclusions.
- Normalize the narrow language variant `office` to the already captured `ofc` area for retrieval, while deferring broader fuzzy semantic matching until it can be corrected and tested safely.

## 2026-05-26 - Beta Distribution And Brain-First Presentation

- Treat provenance, raw captures, and timestamps as internal memory integrity data. LUCY's primary experience should yield connected insights and actions, not require a user to navigate storage or audit screens.
- Ship tester builds in offline on-device mode with no external provider enabled and no bundled API key. Distribution must not weaken the private-by-default contract while the safety layer is still being hardened.
- Use direct APK installation or EAS internal distribution for Android testers. Use EAS with Apple signing and TestFlight for iPhone testing because the current Windows environment cannot produce a signed iOS app locally.

## 2026-05-26 - Journal-First Model Selection And Reinterpretation

- Optimize the primary LUCY workflow for a few rich, multi-minute journal entries per day rather than instant response latency. A deeper local model taking several minutes is acceptable when it improves memory outcomes.
- Expose only local model choices actually shipped by the current mobile runtime: Qwen3 0.6B, Qwen3.5 0.8B, Qwen3.5 2B, Qwen3 4B, and Phi-4 Mini 4B. DeepSeek remains a future runtime/export evaluation because it is not in the installed ExecuTorch registry.
- Do not describe Claude as a local candidate. Anthropic provides Claude as hosted service access; LUCY may benchmark it remotely only on permitted synthetic/ordinary inputs and only after proper key handling.
- Preserve original thoughts across model changes and provide an explicit full reprocessing operation that rebuilds generated interpretations, connections, and reminder schedules from scratch. Do not silently blend interpretations from different local models.
- Evaluate product outcomes, not only extraction: one hundred cases cover ten outcomes, and private ideas/credential cases are local-only regardless of model quality comparisons.

## 2026-05-26 - Longitudinal Benchmark Isolation

- Use the Eleanor Vance dataset as a realistic chronological memory benchmark, separate from controlled single-input outcome fixtures and separate from any user's LUCY memory database.
- Accept the user's confirmation that the dataset carries an MIT license, while recording that the archive itself did not include the license text or Kaggle source URL.
- Keep all Eleanor raw data and model results local-only by default. The user confirmed its password-shaped facts are made-up test material, but protecting such memories is itself an evaluation requirement; health-shaped context also remains present. Open-source licensing grants reuse rights but does not remove privacy-routing requirements.
- Score future experiments by chronological recall and manual-injection question outcomes, not by importing benchmark material into the production app experience.

## 2026-05-27 - Benchmark Routing And Outcome Priority

- Permit the user-approved synthetic Eleanor benchmark to run through Claude only via an experimental benchmark path. Password-shaped values are inspected/redacted locally by `phi3` before outbound calls, with deterministic redaction kept as a fail-safe.
- Do not apply this remote benchmark permission automatically to personal LUCY memories or distributed app builds. Normal product defaults remain local/private-first.
- Freeze additional privacy enhancement work during the current outcome sprint. Existing protection remains enforced, while engineering attention shifts to whether LUCY retrieves and connects useful memory.
- Use oracle-memory scores to compare answer formulation quality and chronological retrieval scores to measure LUCY's brain. Since retrieval reached only `9/50` while Sonnet answered `45/50` when given correct context, retrieval improvement is the immediate product priority.
- Extend the same benchmark-only redacted remote lane to OpenAI Responses API models so provider quality is evaluated on identical inputs. Use general-purpose GPT tiers (`gpt-5.4-nano`, `gpt-5.4-mini`, `gpt-5.4`, `gpt-5.5`) rather than coding-specific models for personal-memory answering.
- Do not interpret GPT-5.4 Nano's high strict-short-answer benchmark score as an overall intelligence ranking. It is a candidate for the later retrieved-context test; product routing should follow timeline outcomes, not oracle prompt compliance alone.

## 2026-05-27 - Hybrid Tester Routing And User-Key Storage

- Use `gpt-5.4-nano` as LUCY's first remote beta provider because it performed strongly on the current strict synthetic benchmark and is suitable for quick iteration; continue testing retrieval quality before treating it as a final intelligence choice.
- Store each tester's OpenAI API key through `expo-secure-store` after explicit entry in Settings. Never bundle the developer's or sponsor's provider key inside an installable APK or TestFlight binary.
- Give the user an explicit per-thought privacy control. Preserve its value separately from derived privacy classification so reprocessing cannot remove a user-provided protection decision.
- Permit protected remote analysis only as a clearly labelled beta experiment: an on-device model must substitute placeholders first, raw private text remains encrypted locally, deterministic credential/card masking is a second guard, and masking failure routes processing locally.
- Continue to distinguish laptop Ollama `phi3` from phone execution. Mobile tester builds use the ExecuTorch model catalog; `Phi-4 Mini 4B` is the current Phi-family phone option.

## 2026-05-27 - Mobile Configuration And Keyboard Ergonomics

- Treat a Settings row as the primary interaction surface and retain the `i` circle only as an affordance; a calm compact list must still be obviously tappable.
- Lift Capture and Ask composer docks directly in response to Android keyboard height. Moving outer scrolling-content padding does not reliably keep a bottom composer visible on devices using edge-to-edge keyboard layouts.
- Hide brand/navigation chrome while typing to reserve space for the current thought or question. Validate full software-keyboard behavior on a physical phone because emulator keyboard modes can differ materially.

## 2026-05-27 - Android Keyboard Stability Correction

- Do not remove large parent UI regions or transform a focused `TextInput` in reaction to Android keyboard-open events; physical-device testing showed that approach can dismiss focus immediately.
- Use Android native `adjustResize` for Capture and Ask composer stability. Keep keyboard-aware lifting limited to the Settings modal path that was validated and did not reproduce the focus loss.
- Label remote credential input at the point of entry: it accepts OpenAI keys only, and the active beta route is GPT-5.4 Nano.

## 2026-06-05 - Transcription Language Preferences

- Treat selected languages as user context, not an instruction to force the first non-English language across an entire recording.
- Use no OpenAI language hint when multiple languages are selected or when the selected language is not in the documented speech-to-text language set.
- Keep a defensive retry without a hint when the API rejects a supplied language, because server-side model support can differ or change.
- Do not use deprecated `@react-native-voice/voice` on Expo SDK 56 / React Native 0.85; its repository records missing New Architecture support.
- Use the SDK-56 release of `expo-speech-recognition` and set `requiresOnDeviceRecognition: true` whenever the user selects On-device. Never silently upload that session as a fallback.
- Use the first selected non-English locale for Apple's single-locale recognizer (`te-IN` for English + Telugu), while remote mixed-language transcription remains unforced.
