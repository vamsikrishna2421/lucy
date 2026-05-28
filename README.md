# LUCY - Your Second Brain, Always Listening

Phase 1 mobile prototype for capturing clean text from a keyboard such as WhisperFlow, extracting structured memory, storing it locally, and creating Obsidian-compatible notes for non-private captures.

Development experiments, failures, fixes, and lessons are recorded as a running narrative in [.codex/ENGINEERING_JOURNAL.md](.codex/ENGINEERING_JOURNAL.md).

## Implemented

- Expo React Native TypeScript application with Capture, Today, Ask, and Settings views.
- WhatsApp-style capture inbox: sending a note enqueues it immediately, clears the composer, and continues organizing in-app without a review/save interruption.
- Android/iOS incoming text-share configuration through `expo-sharing`, so WhisperFlow text can be sent into the inbox.
- Visible voice placeholder; text capture remains the Phase 1 input method through WhisperFlow keyboard or paste.
- Durable queued/processing/completed/failed capture states with automatic retry, share deduplication, and append-only structured extraction snapshots.
- Single AI provider boundary routing ordinary input to GPT-5.4 Nano only after the user securely enables it; protected input passes through on-device placeholder masking before any remote analysis.
- Per-thought `Contains private details` control, preflight sensitivity scanner, and private-by-default handling for extracted ideas.
- SQLCipher-configured SQLite storage with a key retained through SecureStore.
- Device vault initialization and append-only markdown notes for non-private captures.
- Today experience with scheduled reminders, focus cards, capture status feed, and library tabs for todos, ideas, expenses, places, and interests.
- Local LUCY reminder notifications for explicit English date/time requests.
- User-enabled, OS-managed background organizing for queued thoughts during battery-friendly opportunities.
- Settings observability for queue counts, automatic retry state, last background activity, and local privacy behavior.
- Timestamped capture history with linked completion updates for explicit recent payment tasks.
- Chat-style Ask surface for today's tasks/deadlines, monthly payment insight, and named Memory Map relationships; new sessions open clean and prior encrypted conversations are explicitly available from History.
- Optional `Context` lane in Today where ambiguous memories ask for clarification without rewriting the original timeline.
- Obsidian-visible `Memory/Connections` notes for each new non-private memory, exposing wiki-linked relationships in graph view.
- Encrypted in-app `Memory` map that derives entities, connections, and learning signals with evidence counts and confidence rather than silently rewriting captures.
- On-demand `Re-organize now` control and optional structured-memory view, preserving each raw timestamped thought while exposing a cleaner derived representation.
- Compact Settings list: current status remains visible, while explanations open only through small information controls.

## Run

```bash
npm install
npm run typecheck
npm run test:phase1
npx expo run:android
```

SQLCipher is enabled through the native `expo-sqlite` config plugin. The app intentionally refuses to initialize private storage when SQLCipher is unavailable, so use a development build (`expo run:android` or an EAS development build), not Expo Go.

On Android, this project includes a `patch-package` compatibility fix for React Native's Gradle plugin so native builds run against the Expo SDK 56 Gradle toolchain. `npm install` applies it automatically.

Copy `.env.example` to a local environment file if development overrides are needed. The default local runtime is the on-device `Qwen3 0.6B` model; after installation, open Settings and prepare the desired on-device model. The current phone runtime does not ship Ollama `phi3`; users wanting a Phi-family phone model can choose `Phi-4 Mini 4B` in Settings on capable devices. Thoughts may be processed by `GPT-5.4 Nano` only after the user opens `Settings > Remote intelligence`, securely stores their own OpenAI key on that device, and enables it. Marked or detected private thoughts are first masked by the selected on-device model and retain their original only in encrypted local storage. Shared builds do not bundle an API key.

### Android Release Build On Windows

ExecuTorch native compilation exceeds Windows path limits from this workspace, and a junction is insufficient because CMake resolves package paths. Use a physical short build copy for local release validation:

```powershell
$source = (Resolve-Path .).Path
$target = 'C:\LucyNativeBuild'
New-Item -ItemType Directory -Force -Path $target | Out-Null
robocopy $source $target /E /XD node_modules .git android\build android\.gradle android\app\build .expo
Set-Location $target
npm install
npx expo run:android --variant release --no-bundler
```

The app bootstrap explicitly initializes the React Native standard environment before Expo is imported. This is required for the bundled Android release build so Expo's runtime sees `FormData` and `AbortSignal`.

## Test On The Android Emulator

1. Build and install the native app from the short physical copy above. The on-device runtime requires Android 13+; the current emulator test target is API 36.

2. Open LUCY Settings and tap `Prepare on-device intelligence`. The fast model downloads about 482 MB once and can be removed again from Settings.

3. Submit ordinary text such as `Paid 180 for auto today and remind me to call the landlord tonight`.
The thought should appear immediately as `Organizing`, then `Remembered`, and create a markdown memory entry in the device vault.

4. Turn on `Contains private details` beneath the composer and submit a fake sensitive test thought such as `My private health project is called Fern and password is ExampleOnly-4829`.
It should show a lock, keep the original in encrypted app storage, and must not create a new vault markdown note. If remote intelligence is enabled, only locally masked placeholder text is eligible to reach GPT-5.4 Nano. Treat this masking lane as experimental and use fake private details during beta.

5. Submit `Remind me on May 26 2026 at 12:00 PM to review my sprint.` and open `Today`.
It should schedule a LUCY notification and appear under reminders at the device-local time.

For Android share-intent testing from a terminal, escape spaces in the text passed through `adb shell`:

```powershell
$adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
& $adb shell am start -n com.anonymous.lucy/.MainActivity -a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT 'Paid\ 17\ dollars\ for\ soup\ today.'
```

The emulator proof does not require an Ollama tunnel. `EXPO_PUBLIC_LOCAL_INFERENCE=ollama-dev` and `npm run android:connect-local` remain available only for explicit laptop-backed development. Fast on-device inference is functional, but quality and latency still need broader benchmarking before release.

If the emulator cannot reliably download the model from its official source, a development build may set `EXPO_PUBLIC_DEVICE_MODEL_ASSET_BASE_URL` to a local static server containing the same `.pte`, `tokenizer.json`, and `tokenizer_config.json` files. This changes asset delivery only; model inference still executes inside LUCY on the Android device. When this environment variable is set, Android permits local cleartext HTTP for that development build only.

## Background Organizing

On first launch, LUCY asks whether it may organize queued thoughts in the background. When enabled, LUCY registers a deferrable operating-system background job and processes one queued thought per run.

- Android and iOS decide when a background opportunity occurs; it is not a guaranteed schedule.
- The system favors conditions such as adequate battery or charging and available network access.
- On iOS, background processing must be tested on a physical device, not the simulator.
- Use Settings, or tap the `Local-first` / `Background on` pill in the header, to change this preference and view queue/background status.
- Tap `Run` beside `Re-organize now` in Settings to rebuild the local Memory Map immediately; its `i` panel explains the local-only operation and last run.

## Ask And Memory Timeline

Every captured thought retains its original timestamp in encrypted storage, and new non-private markdown notes use that capture time rather than the later processing time. This lets later organization reason about sequence without rewriting history.

For the first linked-update workflow, an explicit recent payment task such as `I need to pay the internet bill tomorrow.` can be followed by `Paid`, `Paid it`, or `Payment is done.`. LUCY links only a later completion to a pending payment task from the preceding two hours and renders it as a timestamped activity beneath the original thought.

The `Ask` tab is a private chat surface with follow-up input. It answers local questions about today's pending tasks and timed deadlines, for example: `I came to my office just now. What pending tasks do I have to do today, and what deadlines do I have today?`

Ask can also retrieve an organized project, area, or person from the encrypted Memory Map. Questions such as `What is happening with Data Platform?`, `Who is connected to Horizon?`, or `What office work keeps repeating?` return stored relationships with confidence and remembered context. `Summary of my payments this month?` returns a locally calculated spending insight by category and payment. These answers are retrieval from local encrypted memory, not internet/model guesses.

Entering Ask opens a clean new-chat surface; previous encrypted threads are visible only through `History`, where a selected conversation can be continued. Each question is retained as a local organization signal so later organization can learn which dedicated views are useful. Conversational resolution of vague follow-ups such as `What about its deadlines?` is still to be implemented.

If a short update such as `Paid it.` cannot be truthfully linked to an earlier payment task, LUCY archives it locally instead of repeatedly retrying local inference. Archived captures remain encrypted history for future reorganization; they are not deleted.

LUCY also archives clearly misclassified active results, such as a payment statement accidentally stored as a task or deadline. The original capture remains in encrypted history, but it no longer appears in current pending-work answers.

## Needs Context And Visible Memory

The `Today` view includes a `Context` lane for voluntary enrichment. When an extraction explicitly asks for clarification, or a short completion such as `Paid it.` cannot safely be linked, LUCY records a local encrypted question. Answering it removes the question from the open list while preserving the timestamped original memory and the added context for future organization.

SQLite remains LUCY's encrypted source of truth: events, status, provenance, relationships, answers, and corrections belong in queryable storage. Obsidian markdown is a human-readable projection for permitted non-private knowledge, not the intelligence database.

For every newly processed non-private capture, LUCY writes an append-only connection page under `vault/Memory/Connections`. Its wiki-links point at the daily memory and any extracted projects, areas, people, or interests, allowing an Obsidian graph demonstration of the knowledge network developing over time. Private captures remain SQLite-only and never appear in this showcase layer.

LUCY becomes more useful day by day through retrieved structured memory, links, user clarification, and future nightly organization. The on-device base model is not silently retrained on personal data in this MVP; avoiding uncontrolled daily fine-tuning preserves auditability, privacy, and the ability to correct a mistaken interpretation.

## Memory Map

The `Today > Memory` view is LUCY's first inspectable intelligence layer. It rebuilds a derived local map from completed structured memories, answered Context items, and repeated Ask needs. Original captured thoughts are never replaced.

- `Emerging` means a topic or connection was seen once.
- `Supported` means it was observed in at least two separate remembered thoughts.
- `Confirmed` means it was observed at least three times, or was directly clarified by the user.

The organizer runs on startup, after successful foreground processing, after Context answers and recognized questions, and during permitted background opportunities. It is currently opportunistic rather than guaranteed at a specific nighttime hour, because mobile operating systems control background execution timing.

The Memory Map now feeds Ask directly: when a question names a known topic, LUCY presents its connected entities and the remembered thoughts that support the answer, keeping the intelligence layer inspectable rather than opaque.

For a deterministic local demonstration without a downloaded model, enter two explicit thoughts such as `Project Horizon involves Sam in Marketing area.` and `Project Horizon involves Sam in the Marketing area.` The Memory map then shows evidence-backed supported links among the detected project, person, and area.

Each completed capture can expose a derived structured memory on demand from `Today > Captured`. The original input and timestamp remain untouched; this derived view arranges extracted project, area, actions, reminders, expenses, decisions, and ideas for later retrieval. Running `Re-organize now` backfills this structured view for earlier remembered thoughts.

## Privacy Behavior

- Nothing is sent to an external AI provider by default; the user must enable `Remote intelligence` and supply their own key.
- The composer includes `Contains private details`; detected sensitive patterns also apply protection automatically.
- With remote intelligence enabled, protected thoughts are sent to GPT-5.4 Nano only after the selected on-device model creates placeholder text. If masking fails, LUCY falls back to local processing.
- Extracted ideas are marked `private` even when the model omitted that level.
- Original private content never leaves encrypted device storage and is never written to markdown/sync; a locally masked placeholder representation may be analyzed remotely when the user enabled that experimental beta path.
- Ordinary memories and Ask results do not show a privacy label, keeping the experience quiet and uncluttered.
- Credential-like text such as passwords, PINs, OTPs, or account numbers is masked in app previews and notification bodies.
- Private captures are stored only inside the encrypted database and never written to markdown.
- Normal and local captures produce markdown under the on-device `vault/Daily` folder.
- Non-private captures also produce linked, readable projections under `vault/Memory/Connections` for Obsidian graph viewing.

The regex preflight scanner and small-model placeholder masking are beta safety layers, not proof that every private detail is detected or removed. Use fabricated sensitive data in this test build; production distribution requires stronger evaluated redaction and consent controls.

## Local Model Note

LUCY now defaults to a native on-device ExecuTorch runtime. Settings exposes locally downloadable model choices for different hardware and journal depth: `Qwen3 0.6B`, `Qwen3.5 0.8B`, `Qwen3.5 2B`, `Qwen3 4B`, and `Phi-4 Mini 4B`. Laptop Ollama `phi3` is useful for development benchmarks and redaction experiments, but it is not embedded in the current mobile app. Small phone models prioritize practical setup; the 2B/4B options are intended for slower, richer journal interpretation on capable phones. Changing model can be followed by `Reprocess all memories`, which rebuilds derived understanding from preserved original thoughts rather than combining old and new interpretations silently.

The native runtime currently targets Android 13+ and iOS 17+. iPhone parity still requires a physical iPhone build through macOS/Xcode or an appropriate EAS workflow; connecting an iPhone to this Windows laptop alone does not make native iOS testing available.

LUCY now has a 100-case outcome catalog under `tests/outcome-catalog.ts`, covering action capture, time awareness, spending, decisions, ideas, relationships, resources/preferences, completion linking, memory questions, and privacy. Run `npm run test:outcome-catalog` to validate its coverage.

The Eleanor synthetic benchmark supports two evaluation modes:

- Local model: `npm run bench:kaggle-eleanor:models` runs installed Ollama comparison models without internet calls.
- Remote Claude after local redaction: `npm run bench:kaggle-eleanor:claude` replaces password/card values with placeholders locally before API submission and stores only sanitized score metadata. Health-shaped probes are excluded by default.
- Remote OpenAI after local redaction: `npm run bench:kaggle-eleanor:openai` uses the same protected benchmark flow through the Responses API, with `gpt-5.4-nano`, `gpt-5.4-mini`, `gpt-5.4`, and `gpt-5.5` available for comparison.

The Claude benchmark requires a newly rotated key in `.env.local`; never bundle that
key into an installable app. This experimental synthetic-data route does not change
LUCY's app behavior now optionally evaluates the same idea for user-marked private thoughts: the original remains local and only placeholder text can enter a remote request after the user enables it.

## Tester Builds

Beta builds are hybrid-capable with no bundled API key: a tester prepares an on-device model, may independently enable GPT-5.4 Nano with their own key, and can mark a thought private so it is locally masked before remote analysis.

### Android Friends

The distributable Android beta is an APK for Android 13 or newer. After installing it, open Settings and prepare on-device intelligence once while connected to Wi-Fi. Select `Phi-4 Mini 4B` only on a capable phone if you specifically want the Phi-family local experiment. To use GPT-5.4 Nano, add your own key under `Remote intelligence`; use only fake sensitive details while testing the protected-remote switch.

For later cloud-hosted beta links:

```bash
npx eas-cli login
npx eas-cli build --platform android --profile beta
```

### iPhone Beta

An iPhone app must be signed through Apple. From Windows, use EAS Build rather than a local Xcode build:

```bash
npx eas-cli login
npx eas-cli build --platform ios --profile testflight
npx eas-cli submit --platform ios --profile testflight
```

This requires access to an Apple Developer Program account and App Store Connect. TestFlight then provides the installation path for invited testers. The iPhone beta targets iOS 17 or newer and still needs physical-device validation of local model runtime, notifications, background opportunities, and text sharing.
