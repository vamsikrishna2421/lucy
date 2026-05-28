# LUCY Engineering Journal

This is a chronological, human-readable development diary. It records what was tried,
why it was tried, what failed, the fix or workaround, and what was learned. Continue
appending entries during each working session so the development process can be reviewed
later as a story, not only as a list of completed features.

Security rule: never write API keys, passwords, tokens, or private captured user text
into this journal. Provider keys previously pasted into chat must be rotated before reuse.

## 2026-05-26 - Making Private Analysis Truly On-Device

### Where This Session Began

LUCY already had its dark/orange brand, an encrypted queue, automatic retry, local
notifications, background organizing controls, and a Settings screen. Private thoughts
were meant to remain on the phone, but the development validation path had still relied
on an Ollama model running on the laptop through an Android emulator tunnel. That is
useful for development, but it does not answer the product question: will a real phone
process private thoughts by itself?

The goal for this pass was therefore concrete: run extraction within the Android app
process, then measure whether a small local model is fast and accurate enough for basic
English captures.

### Moving The Model Into The App

The native runtime was implemented with `react-native-executorch`. Local/private
analysis now routes through LUCY's existing provider abstraction to a model loaded on
the device. Ollama remains available only as an explicit development override.

The first small model tried was LFM2.5 350M. It loaded in the emulator, which proved
the native integration could work, but it did not consistently return usable JSON for
LUCY's extraction schema. That was not acceptable: a fast model that cannot reliably
create structured memories is not a usable default.

The next candidate was quantized `Qwen3 0.6B`, approximately 482 MB. It produced usable
results for a normal expense and a private startup idea:

- `Paid 17 dollars for soup today.` became a normal expense.
- A private garden app idea became visible within LUCY with a `PRIVATE` badge.

During this validation, the laptop Ollama tunnel was removed. The emulator had no
reverse tunnel on port `11434`, so these results came from the model within the app,
not from laptop inference.

Two reliability problems appeared:

1. A malformed or empty local model answer could be normalized into an apparently
   completed memory. The extraction pipeline was changed to reject non-meaningful
   local output so the capture automatically retries instead.
2. A difficult private extraction could remain busy for over two minutes. The device
   prompt now requests JSON without reasoning, and inference is interrupted after
   75 seconds rather than blocking indefinitely.

### Adding A Repeatable English Model Check

Ad hoc manual examples are useful, but they do not expose regressions consistently.
I added a non-persisting `English model check` in Settings. It runs synthetic test
phrases through the same on-device extraction path while deliberately not writing them
to the encrypted memory database or markdown vault.

The first four checks covered expense, task, timed reminder, and private idea. The
initial prompt passed only 2 of 4: expense and reminder worked, while task and private
idea extraction failed. Compact examples were added to the local prompt, using
different entities in the benchmark from the examples so this was not merely exact
copying. The four-case suite then passed 4 of 4.

The suite was expanded to seven checks by adding place, decision, and credential
privacy cases. It then exposed three failures:

- A requested place was not extracted.
- A decision was not extracted.
- Most importantly, the model repeated a synthetic password-like value in its output.

The place and decision extraction prompt gained concise examples. Credential handling
was not left to model obedience: when local deterministic preflight detects a
credential-like secret, LUCY now replaces extracted visible fields with a neutral
protected-credential result. The raw thought remains encrypted and local to the user,
but the app's generated cards and notifications do not echo the credential.

An automated test was added to assert that a credential value cannot appear in the
sanitized structured extraction.

### Internet Interruption During Device Validation

While preparing the Qwen model again in the Android emulator, the laptop lost internet
connectivity. The emulator model download from the official host failed with connection
reset and DNS errors, leaving a partially downloaded state. The app's existing
`Remove local model download` control cleared model resources without deleting test
memories.

After internet returned, the official model bundle was downloaded once to the laptop.
To avoid another large emulator internet download during development, I added an
optional asset relay:

```env
EXPO_PUBLIC_DEVICE_MODEL_ASSET_BASE_URL=http://localhost:8765
```

A local static server serves only the official public model files, and Android reaches
it through:

```powershell
adb reverse tcp:8765 tcp:8765
```

This is not an inference tunnel. User text still stays inside the Android app and the
model still runs on the emulator. The relay only transfers the same public model asset
that the emulator would otherwise download from its official host.

The first relay build failed in-app with:

```text
CLEARTEXT communication to localhost not permitted by network security policy
```

That failure was useful: Android release builds correctly block plain HTTP by default.
The fix was narrowly scoped. A dynamic Expo config now enables
`usesCleartextTraffic` only when the development relay environment variable is present.
Normal builds retain the default network policy.

Expo Doctor initially objected to the dynamic config implementation because it appeared
not to inherit the static app configuration. Rewriting the config to explicitly merge
the provided Expo `config` object fixed that warning.

### Validation Status At Time Of Writing

The following checks pass:

```powershell
npm run typecheck
npm run test:phase1
npx expo-doctor
```

The relay-enabled native Android release build installed successfully. Settings shows
the development relay explanation, and Qwen prepared successfully inside LUCY. The
final seven-case English benchmark run is the next action in progress.

### First Seven-Case Device Result

The full check finished with `5 of 7 checks passed`. Each row was run inside the
Android app with the Qwen model; `adb reverse` showed the asset relay port `8765` and
no Ollama inference port `11434`.

| Case | Result | Time | Observation |
| --- | --- | ---: | --- |
| Expense | Fail | 44.0s | Did not reliably produce the explicit 23 dollar expense. |
| Task | Pass | 37.0s | Produced a call task. |
| Reminder | Pass | 41.7s | Produced a timed reminder. |
| Private idea | Pass | 66.0s | Classified and extracted the private idea. |
| Place | Pass | 41.8s | Produced the requested place. |
| Decision | Fail | 75.1s | Hit the bounded generation limit without a usable decision. |
| Credential privacy | Pass | 42.9s | Produced `Protected credential thought` without echoing the synthetic secret. |

This result changes the next implementation step. Clear facts such as `Paid 23
dollars for groceries today.` and `I decided to cancel my gym membership next month.`
do not need a 40 to 75 second model gamble. I will add a tightly limited deterministic
English fast path for such unambiguous statements, while keeping the model for richer
or ambiguous thoughts.

### Turning Follow-Ups Into A Timeline

While looking at the capture feed, the user pointed out that a later phrase such as
`Paid` should often not become a separate floating memory. It can mean an earlier task
has been completed, and its timestamp is useful as an audit trail.

There were already short `Paid` cards in this emulator database, but those were created
by earlier automated input attempts and are not safe to reinterpret retroactively.
Changing historic data based only on a guess would teach the wrong lesson. Instead,
the new behavior begins prospectively:

- An explicit payment task such as `I need to pay the internet bill tomorrow.` is
  extracted deterministically as a pending expense-related todo.
- A later concise follow-up such as `Paid`, `Paid it`, or `Payment is done` checks for
  a recent pending payment-related todo.
- Only when such a target exists does LUCY mark that task completed and link the
  follow-up capture to the original capture.
- The original capture remains the visible memory, and the child update appears below
  it with the completion timestamp. Both raw captures remain encrypted for auditability.

This intentionally does not attach a vague `done` to the most recent thought; that
would create silent false completions. Broader matching should later use entity context
and a confidence threshold, with user correction when the match is uncertain.

### The First Timeline Test Found A Migration Bug

When the timestamped build was installed over the existing encrypted emulator database,
startup failed with:

```text
no such column: parent_capture_id
```

The new index on linked captures had been declared in the initial schema block. That
works for a fresh database, but an existing database reaches that statement before its
new `parent_capture_id` column is added by migration. The fix was to move index
creation below the `ALTER TABLE` migration checks. Reinstalling the corrected build
recovered the existing database without deleting remembered content.

With the corrected build running, every visible capture displayed its stored arrival
time. New markdown writing was also changed to use the capture timestamp rather than
the later processing time, so delayed/background organization cannot blur when the
thought originally happened.

### A Retry Revealed Why Chronology Must Be Enforced

A fresh task, `I need to pay the internet bill tomorrow.`, was remembered immediately.
However, an old failed test fragment containing only `Paid` was eligible for automatic
retry. It found the newly created pending payment task and completed it even though the
fragment's timestamp was earlier than the task. The later real completion update then
had nothing pending to attach to and remained in retry.

This is an important failure, not just test noise: an append-only timeline is useful
only if automatic linking respects time. The matcher was therefore tightened so a
completion may link only to a payment task that already existed when the follow-up was
captured, and only within a two-hour context window. Older uncertain fragments remain
unlinked for later review or higher-confidence reorganization.

### Adding Ask LUCY

The user then asked for a question section: on arriving at the office, they want to
ask what pending tasks and deadlines exist for today, and they want repeated question
patterns to improve future organization.

The first implementation is deliberately local and factual:

- Added an `Ask` tab with an office-arrival example question.
- For questions about today's pending tasks and deadlines, LUCY reads encrypted todos
  and timed reminders directly rather than invoking a language model.
- Added an encrypted `questions` table recording the timestamped query, recognized
  intent, answer summary, and an organization hint.
- The stored hint represents a future overnight-organization input, such as learning
  that a dedicated Today/work-arrival view is valuable. It does not claim that full
  overnight reorganization exists yet.

During automated testing, importing the question recognizer initially pulled in React
Native database modules and failed under the Node test runner. Splitting the pure
intent recognizer into `askIntent.ts` preserved fast platform-independent tests while
the mobile-only answer service remains in `ask.ts`.

### Lessons So Far

- Moving inference onto the device is separate from delivering the model asset to the
  device; the latter can be assisted in development without weakening the privacy path.
- A small model needs deterministic guardrails around secrets, dates, and malformed
  output. Prompting alone is not a privacy boundary.
- Built-in diagnostics are valuable: a visible, non-persisting benchmark changed model
  quality work from guesses into reproducible evidence.
- Android emulator storage and network policy are part of product validation, not just
  setup inconveniences; they reveal what a real install workflow must explain clearly.

### Fresh Inputs Must Beat Old Retries

After adding the forward-only timestamp rule, I entered a clean new payment task and
then a completion update. The new task organized immediately, but the follow-up stayed
unprocessed while an older failed capture was retried first. This was not a privacy or
matching failure; it was a queue priority problem. A person using LUCY should not have
an immediate update delayed by a stale failure from earlier testing.

The queue now orders untouched new captures before due retry captures. Retries remain
automatic and are still processed when there is time, but fresh human input gets the
fast response path. The test showed the new garden payment task became completed while
older ambiguous retry fragments remained separate.

### A Stored Timeline That Did Not Render

The next Android result was subtle. Today/Library correctly reported that the garden
payment todo was completed, but the Inbox card did not show its linked `Paid it.`
activity. That meant storage worked while display refresh did not.

The reason was JavaScript runtime compatibility. I had used `Object.groupBy` to gather
child events beneath their parent capture. TypeScript accepted it, but the Hermes
runtime packaged in this Android app does not implement that recent API. Once a child
event existed, the asynchronous refresh failed during grouping and the screen retained
the earlier no-activity state.

I replaced `Object.groupBy` in both Capture and Today with a small `reduce`-based
grouping function that works in Hermes. Reinstalling the bundled APK immediately
revealed the stored audit trail:

```text
I need to pay the garden bill today.
Captured 5/26/2026, 11:25:58 AM
Paid it.
Completed 5/26/2026, 11:26:03 AM
```

The earlier parking task also displayed its stored child activity after this fix. The
older unlinked `Paid it.` test fragment continued to show `Will retry`, as intended;
uncertain history was not silently rewritten.

### Development Bundle Detour

Installing a newly built Android debug APK initially displayed a blank/loading screen.
The first cause was ordinary: Metro was not available for that development install.
When I restarted Metro, it bound in a way that was not immediately usable by the
emulator, and the first streamed response also reported an HTTP chunk parsing failure.

I then tried to update React Native's development bundle location through ADB input.
The user caught an important mistake: the automation did not reliably clear all old
text before typing `localhost:8081`, so the address could be malformed. I stopped
treating that setting as trustworthy for feature verification.

The reliable workaround was to generate an embedded Android JavaScript bundle with
`expo export:embed`, package it into the APK, stop Metro, and launch the app from its
bundled code. Native logs confirmed `ReactNativeJS: Running "main"`. The final
timeline and Ask tests therefore did not depend on any Metro address or laptop-hosted
JavaScript.

### Ask LUCY Device Proof

On the embedded Android build, I opened the new Ask tab and tapped its office-arrival
example:

```text
I came to my office just now. What pending tasks do I have to do today,
and what deadlines do I have today?
```

LUCY answered from encrypted local SQLite data:

```text
Today at a glance
3 pending tasks and 1 deadline for today.
```

After scrolling, the screen also displayed:

```text
This question was remembered locally as a useful Today view pattern.
```

The answer included old emulator test rows because this test database intentionally
retains earlier captures and reminders. I did not delete those rows to make a prettier
demo. The meaningful proof is that the query was answered locally, completed payment
tasks were not included as pending work, same-day reminders were surfaced, and the
question pattern was persisted as an organization signal rather than ingested as a
new thought.

### Checkpoint

After the final source edits:

```powershell
npm run typecheck
npm run test:phase1
npx expo-doctor
```

all passed. The next substantial product work is to turn encrypted question-pattern
signals and event timelines into a conservative overnight organization engine, without
losing the original chronological record.

### When The Answer Was There But Looked Missing

After the first Ask implementation, the user tapped Ask and reasonably reported that
nothing seemed to change. The answer existed, but it was drawn below a large example
card, text field, and button. On a phone that is effectively a hidden result: the user
must scroll before discovering that anything happened.

This led to a better product decision than simply scrolling automatically. Ask LUCY is
not a form submission workflow; it should feel like asking a private memory assistant.
I replaced the screen with a chat layout:

- a short LUCY greeting bubble;
- a tappable suggested opening question;
- user bubbles and visibly labeled `LUCY ANSWER` bubbles;
- a fixed composer reading `Ask a follow-up...`.

The first office-arrival prompt now appears as the user's message followed by an answer
bubble titled `Today at a glance`, rather than looking like an unchanged form.

### What `Will Retry` Actually Meant

The Inbox still showed standalone `Paid it.` cards with `Will retry`. These were old
ambiguous test fragments. They were not the linked completion events already rendered
inside the garden and parking task timelines. With no earlier pending payment task that
existed at their capture time, these fragments could never safely be resolved by the
current matching rule.

Continuing to retry them would be bad for two reasons:

1. It confuses the user by presenting hopeless background work as active.
2. It wastes local model time and, in a future paid path, could waste tokens.

Deleting them would also be wrong: the entire point of a memory timeline is retaining
what was actually captured. The implemented policy is therefore archive, not delete.
An unmatched standalone completion fragment is marked archived with a reason, remains
encrypted and timestamped in SQLite, is excluded from Inbox and active retry work, and
can later be considered by an overnight organizer with more context.

A startup cleanup applied this same conservative rule to old failed shorthand
completion rows already in the emulator database. Live validation changed Settings
from visible retry clutter to:

```text
Will retry: 0
Archived: 2
```

Linked task activity remained visible, including the verified garden completion. No
memory row was destroyed.

### Making Ask A Conversation You Can Return To

The next user request was that Ask should preserve chat history so a person can return
and continue the same thread. The in-memory chat UI survived switching tabs within the
mounted app, but closing LUCY would have erased it.

I added two SQLCipher-backed tables:

- `ask_threads` for the active conversation;
- `ask_messages` for timestamped user questions and LUCY responses.

For assistant messages, LUCY saves the displayed answer snapshot rather than re-running
the old question on open. That preserves the historical answer and avoids additional
processing. The separate `questions` signal table continues recording the detected
information need for future organization.

On Android, I entered the office-arrival question and a follow-up:

```text
What deadlines do I have for today?
```

Then I force-closed and reopened LUCY. Returning to Ask restored the follow-up bubble
and its `Today at a glance` answer. This verifies that the history is in encrypted
device storage rather than held only in React component memory.

The remaining limitation is explicit: LUCY keeps conversational history, but it does
not yet resolve a vague follow-up by consulting prior turns. Questions currently need
enough words to match an implemented local retrieval intent. Context-aware follow-up
interpretation should be built together with the overnight organization/retrieval
engine, where corrections and provenance can be handled responsibly.

### Why Paid Appeared As Private Pending Work

The user then noticed an answer that looked plainly wrong: `Paid` carried a private
badge under pending tasks, a soup payment appeared under pending tasks, and a
breakfast payment appeared beneath deadlines. Inspecting the rendered answer confirmed
all three rows. `Buy Coffee` was actually beneath the task header, not the deadline
header, but the layout did not make that distinction clear enough.

These were not reasonable privacy decisions. They were old derived artifacts from
earlier local-model/test processing:

- a shorthand completion was extracted as a task;
- a completed expense was extracted as a task;
- another expense was extracted as a timed reminder.

The capture history remains valuable, but those derived rows should not continue to
drive a current answer. I added archived audit metadata to todos and reminders, plus a
strict cleanup rule that archives only unmistakable errors: standalone payment
completion fragments in pending tasks, payment statements with an amount in pending
tasks, and payment statements with an amount in reminders/deadlines. A normal item
such as `Buy Coffee` stays pending because there is no evidence it is wrong or done.

Ask also now filters these shapes while displaying restored answer snapshots. This
matters because preserving a historic response in encrypted chat storage must not
mean repeatedly showing a known-wrong response as if it is still correct.

The first attempt to install this fix failed because the emulator lacked enough staging
room for a 243 MB APK containing native libraries for several device architectures.
Instead of erasing LUCY data, I rebuilt the same code for the emulator's required
`x86_64` architecture only. The APK shrank to about 109 MB and installed over the
existing database.

The corrected screen, on the same retained database, now reports:

```text
1 pending task and 0 deadlines for today.
PENDING TASKS (1)
Buy Coffee
DEADLINES TODAY (0)
No deadlines scheduled for today.
```

The difference is important: LUCY did not delete the underlying memories to make the
screen look clean. It stopped treating derived categorization mistakes as current
truth.

### When Memory Needs A Little Help

The next question was more fundamental: how does LUCY get smarter as a person's
history grows, and can the audience see that intelligence forming? There is a tempting
but misleading answer: say the phone model is continuously training itself on every
thought. That would be difficult to run, difficult to correct, and dangerous for a
private product because a mistaken inference could become hidden inside changed model
weights.

The more responsible design is a memory system that improves while remaining
inspectable. Original captures remain timestamped events. Derived facts and links can
change with evidence. When LUCY lacks enough evidence, it can ask rather than guess.

I added an encrypted `context_requests` table and a `Context` lane inside Today.
Existing unmatched shorthand completion fragments were a useful test case: instead of
silently attaching `Paid it.` to the wrong task or retrying it forever, LUCY now asks:

```text
What earlier task did this completion update refer to?
```

On the retained Android database the Now screen showed:

```text
2 memory details could become clearer
```

I opened Context and supplied an explanation for one old emulator test fragment. The
open count became one. The capture itself was not deleted or rewritten; the additional
meaning was stored as a local, timestamped answer for the future organizer.

### Showing The Brain Without Exposing The Brain

SQLite is the right underlying memory engine. It can answer temporal and relational
questions, store corrections and confidence, and encrypt private material. Obsidian is
better for demonstration: its wiki-links and graph view make relationships tangible to
an audience.

These roles are now separate on purpose. For every newly remembered non-private
thought, LUCY still writes its Daily markdown note and now also writes an append-only
note under `vault/Memory/Connections`. That page links the daily thought to any safe
extracted projects, areas, people, and interests. Private thoughts never enter the
markdown projection.

On Android I captured:

```text
I need to pay the design invoice today.
```

It was remembered and created:

```text
files/vault/Memory/Connections/2026-05-26-18-Pay-the-design-invoice-today.md
```

The page contains an Obsidian link back to the originating Daily memory and its action.
Richer future thoughts that mention people, projects, areas, or interests will create
visible graph links. This is the beginning of a showable LUCY brain, while encrypted
SQLite remains the accurate local memory behind the presentation.

### Keeping Ask Private On Return

The Ask history feature originally optimized for continuity: the most recent
conversation restored automatically and even stayed mounted when switching to Today
or Capture. The user pointed out the other side of that choice. Opening Ask is often
the beginning of a new question, and an old conversation visible immediately is both
cluttered and unnecessarily exposed on the screen.

I changed the contract. Ask now enters as a clean new-chat surface. Stored
conversations remain encrypted in SQLite, but they are shown only after tapping
`History` and selecting a thread. A historical thread can still be continued with a
follow-up question. Navigating away discards only the visible selection; it does not
delete the stored conversation.

This required two implementation changes:

- Ask is unmounted when another top-level tab is selected, so local screen state cannot
  remain visible on return.
- The database now lists non-empty threads for History, while a new thread is created
  only after the user asks the first question.

On Android, Ask first rendered only its welcome prompt, suggested question, composer,
and History button. History then displayed the stored office-arrival conversation with
four messages; selecting it restored both earlier responses. After switching to Today
and returning to Ask, no answer bubbles were visible, only the clean new-chat screen.

### The First Inspectable Memory Map

After deciding not to spend the next sprint expanding Obsidian, the useful question
became: what intelligence can LUCY show inside the app while remaining honest about
where it came from?

I added four encrypted derived tables: entities, connections, insights, and
organization runs. These are explicitly disposable projections, unlike the timestamped
captures. Every organizing pass rebuilds current derived knowledge from the latest
completed extraction for each capture, plus user clarification and repeated Ask
patterns. This avoids a common memory-system failure where rerunning organization
increments the same evidence again and gradually makes a guess look certain.

The confidence language is intentionally restrained:

```text
emerging   = one extracted observation
supported  = two separate remembered thoughts
confirmed  = three observations, or a direct user clarification signal
```

The organizer does not turn an arbitrary free-text clarification directly into an
entity relationship yet. It records the user-provided clarification as a confirmed
learning signal, because using it to rewrite relationships without interpretation and
correction support would overclaim.

The first retained-data Android screen was reassuringly sparse:

```text
Organized 12 remembered thoughts into 0 entities, 0 connections, and 2 insights.
```

It displayed the answered `Paid it.` context and the repeated desire for a today's
tasks-and-deadlines view. It did not manufacture people or projects from expense/task
test fragments.

For a deterministic device proof of actual connections, I added a small explicit
English capture path for statements of the form:

```text
Project Horizon involves Sam in Marketing area.
```

This is not a hardcoded project or a replacement for natural interpretation; it is a
bounded rule that accepts only relationships the user literally states. After
capturing two independently worded Horizon statements, the Memory panel reported:

```text
Organized 14 remembered thoughts into 3 entities, 3 connections, and 2 insights.
```

Scrolling showed:

```text
Horizon involves Sam                 supported
Horizon belongs to area Marketing    supported
Marketing includes Sam               supported
```

Each card states it was seen together in two remembered thoughts. That is the beginning
of day-by-day intelligence in a form the user can inspect and eventually correct,
without pretending the model retrained itself or allowing the organizer to erase the
events that produced its conclusion.

### From Raw Thoughts To A Quiet Control Room

The next request changed two related parts of the product. The user wanted to press a
button before a two-hour nap and let LUCY make progress immediately, rather than
waiting for an operating-system background opportunity. They also did not want
technical explanations, privacy labels, and generated text filling every screen.

I started with the memory operation. A new `Re-organize now` action performs the same
local derived-knowledge rebuild as startup/background organization, but records its
trigger as `manual`. Raw captures remain untouched. I also added a separate encrypted
`structured_text` representation generated from each extraction. That representation
can be regenerated on an organization pass, which means old raw thoughts can gain a
more readable working form without losing their audit history.

To exercise it with a recognizable work context, I sent three device memories:

```text
For ofc work project Data Platform, I need to validate dbt incremental models in Snowflake today.
For ofc work project Data Platform, I need to troubleshoot the ADF ingestion pipeline today.
For ofc work project Data Platform, I need to build a Python and shell scripting reconciliation utility today.
```

The first automated Ask attempt used a longer sentence through ADB input. Android
truncated the text, leaving an incomplete test question in encrypted emulator history.
That was useful in its own small way: UI automation is not proof until the input itself
has been inspected. I retried with the short question `Tasks related to ofc today`,
and LUCY returned the three correct work tasks and zero deadlines.

Then I changed the visual hierarchy. A remembered ordinary item no longer displays a
large `NORMAL` badge. Ask answers no longer spend screen space repeating privacy
classification. Private memory can still show a restrained lock; passwords and
credential-like data keep their stronger masking rules. In Captured, structured
content is hidden behind `View structure` until requested. Expanding the latest
office item showed:

```text
Project: Data Platform | Area: Ofc work
Actions: Build a Python and shell scripting reconciliation utility today [high]
```

Finally, Settings had become a documentation page: useful information, but too much
of it visible all at once. I changed it into six compact rows: on-device intelligence,
English model check, background organizing, re-organization, processing queue, and
privacy. Status stays visible. A small `i` button opens an explanation sheet only when
the user asks for it. `Re-organize now` still keeps a direct `Run` action because that
is a real operation, not just configuration.

The native build also repeated a familiar lesson. I copied updated code into
`C:\LucyNativeBuild`, but the first command accidentally ran Gradle from the original
long path; ExecuTorch failed in CMake exactly as before. Running the same build from
the physical short copy succeeded. I installed over the existing encrypted emulator
data, opened Settings, saw all six options in one view, opened the re-organization
information sheet, and tapped the action. The last run changed to:

```text
Last run: 5/26/2026, 4:06:44 PM / manual
Organized 17 remembered thoughts into 5 entities, 4 connections, and 2 insights.
```

This pass left LUCY more inspectable without making it noisier: the original memory
timeline is intact, the derived layer can become cleaner over time, and explanation is
available without crowding ordinary use.

### Letting The Memory Map Answer Back

The Memory panel proved that LUCY could build visible relationships, but it still made
the user hunt through the map manually. The next useful step was to let Ask answer a
question about those relationships while showing where the answer came from.

I kept this path deterministic and local. Ask now recognizes an English question that
names an organized project, area, or person, looks it up in encrypted SQLite, and
collects the latest extraction snapshots supporting that entity. I added one narrow
normalization for the retained demonstration data: `office work` can retrieve the
captured `ofc work` area. That is a controlled synonym, not permission for the app to
invent broad relationships.

The answer card deliberately does not sound omniscient. It displays a connection, its
confidence, the number of supporting remembered thoughts, and each source timestamp
with the action that was extracted. On the Android emulator, the first proven query
was:

```text
What Data Platform memory
```

LUCY responded locally with the confirmed connection `Data Platform belongs to area
Ofc work` and cited all three remembered work actions: validating dbt incremental
models in Snowflake, troubleshooting the ADF pipeline, and building the Python/shell
reconciliation utility. Two more questions tested different paths:

```text
Who connected to Horizon
What office work keeps repeating
```

The Horizon answer showed the supported links to Sam and Marketing, each backed by
two remembered thoughts. The office wording resolved back to `Ofc work` and cited
the same three Data Platform actions. This is important: the output is useful because
it is traceable, not because it makes a more confident claim than the memory supports.

Device packaging had two mundane but educational failures. My first short-path copy
ran while already located inside `C:\LucyNativeBuild`, so it copied files onto
themselves and left an older APK installed. The older behavior immediately revealed
that the correct bundle was not on the device. After an explicit source-to-short-copy
build, the Android transport briefly became unavailable; restarting the AVD without a
data wipe preserved the encrypted test memory. An unrelated emulator system service,
Private Compute Services, repeatedly crashed on that boot and blocked interaction, so
I disabled that emulator-only package after checking that LUCY itself was not the
failing process.

After the live retrieval proof, I installed a final wording-only build that guides a
new Ask session toward project, area, and person questions. Static validation remained
clean: TypeScript compilation, the focused Phase 1 tests, and Expo Doctor all passed.
The next missing conversational piece is reference resolution: after LUCY explains a
project, a follow-up like `What about its deadlines?` should understand the selected
topic without making the user type its name again.

### Moving From Fast Notes To Deep Journals

The product assumption changed in an important way. I had been treating local
processing time as a major problem because a note could take more than a minute to
extract. The user's real habit is different: they speak a two-to-three-minute diary
update only every few hours, and they are comfortable waiting even five minutes if
the resulting understanding is stronger.

That changes model selection from `fast enough for continuous intake` to `deep enough
to understand a meaningful journal entry privately`. I inspected the model registry
actually installed with `react-native-executorch`. It offers Qwen3 0.6B, Qwen3.5
0.8B and 2B, Qwen3 4B, and Phi-4 Mini 4B. It does not contain a DeepSeek package,
and there is no entry named Qwen 3.6. Claude is not an on-device candidate at all:
Anthropic exposes it as a hosted service rather than downloadable phone weights.

LUCY now has an encrypted runtime choice of those supported local models in Settings.
The lightweight model remains available for ordinary hardware, while Qwen3.5 2B is a
sensible first journal-quality trial and the 4B models are deliberately slow deep
options for high-memory phones. Generation windows extend to five minutes for those
deep tiers, matching the real workflow rather than timing out quality work too early.

A model switch raises a more serious question than downloading a different file:
what happens to the understanding produced by the previous model? Appending new
interpretations on top of older generated todos, payments, reminders, and links would
silently corrupt the brain. I therefore added `Reprocess all memories`. It keeps the
original user thoughts, cancels generated reminder schedules, clears generated
interpretation tables, and queues the originals for new interpretation with the
selected model. User-provided context remains part of memory. The operation refuses
to start while another memory is actively being interpreted.

At the same time, the user showed an Ask result for `Summary of my payments this
month?` that returned an empty task/deadline answer. That was a product miss, not a
model-quality question. I added a local monthly spending response that totals recorded
payments and groups them by category. I also removed visible timestamp emphasis from
connected-memory answers: timestamps remain internally useful for organization, but
LUCY should present a connected brain and useful insight, not the location of its
storage records.

Finally, model debates need a scoreboard. I created a one-hundred-case outcome catalog:
ten cases each for actions, time awareness, spending, decisions, ideas,
relationships, resources/preferences, completion updates, memory questions, and
privacy. Sixty ordinary synthetic cases may be compared with Claude; twenty exercise
LUCY's multi-memory outcomes; and twenty containing ideas or protected information are
strictly local-only. This prevents a model comparison from quietly breaking the
privacy promise in pursuit of a nicer number.

### Looking For A Real Diary Benchmark

The user proposed a Kaggle dataset named `Eleanor Vance daily records and manual
injections` as a more realistic benchmark source than hand-written fixtures. That is
exactly the right kind of pressure test for LUCY: diary-like streams can measure
cross-entry connections and yielded insights rather than only whether one sentence
was parsed into JSON.

I did not import it blindly. Public search did not reveal that exact dataset title,
and the current Windows machine has neither Kaggle CLI installation nor Kaggle
credentials. Before using any diary-shaped corpus, LUCY needs the actual dataset
URL/archive, its license, whether records are synthetic or contain personal data, and
its columns/time sequence. Once available, it can become a separate realistic
benchmark lane layered above the existing one-hundred controlled outcome cases.

### Opening The Eleanor Benchmark Carefully

The user then placed `kaggle_dataset.zip` in the project root and confirmed that its
Kaggle license is MIT. I did not drop it into LUCY's normal memory database. A
benchmark can resemble user memory so closely that it is easy to pollute a test phone
with fictional facts, or worse, accidentally send private-shaped data to a hosted
model during an A/B run. I extracted it into a dedicated ignored benchmark directory
and began with structure-only inspection.

The archive contains two JSON files. The first has a profile plus `1,460` daily
records from `December 1, 2020` through `November 30, 2024`. Every day includes
tasks, what was completed yesterday, and a journal entry; almost every day includes
notes as well. The second file contains `50` manual injections, each with a date,
an injected note, a test question, and expected response content. This is unusually
useful for LUCY because it tests whether remembered facts remain answerable after a
long stream of daily context, rather than only checking one prompt at a time.

The important catch is that this is a local-only test lane. Inspection detected
password-shaped material, many health-related days, and extensive family or
relationship context. The user clarified that the password values are deliberately
made-up test facts. That makes them safe benchmark inputs locally, but not
unimportant: a privacy-first memory system should handle a fictional secret with
the same protective behavior it would apply to a real one. MIT permission means we
can build with the dataset; it does not automatically authorize sending the whole
memory stream through a remote comparison path.
I added `npm run test:kaggle-eleanor`, which checks the dates, schemas, record counts,
and protected-content flags while outputting only aggregate facts. I also ignored the
ZIP, extracted JSON, and generated result directory so sensitive-shaped test material
does not drift into version control by accident.

The next experiment is now clear: create an isolated local benchmark database, feed
daily memories chronologically, ask each injection question only after its injection
date, and score whether LUCY recalls the expected answer while keeping protected
content entirely on-device. That result will tell us far more about the brain we are
building than a single impressive answer screenshot.

### Comparing Answer Quality Without Losing Sight Of Memory

The user made a pragmatic call: use the privacy work already in place and stop
letting it delay the intelligence experiment. That does not mean removing privacy.
It means holding the existing boundary steady while asking the harder product
question: which model yields better answers, and can LUCY recall the right evidence
in the first place?

For the synthetic Eleanor probes, I built an oracle-memory scorecard. In this test
the correct injected fact is handed to the model together with the question. This
separates answer formulation from retrieval. Two local Ollama models were runnable:
`qwen2.5:1.5b` answered `13/50` according to the expected-content scorer at an
average `2.91s` per probe, while `phi3` answered `26/50` at `10.20s`. A downloaded
`qwen3.6` model could not be fairly scored: Ollama reported it needed `24.3 GiB` of
available memory and the laptop had only about `12.5 GiB` available at the attempt.

The user then configured a fresh local Anthropic key and asked for the same benchmark
against Claude Haiku and Sonnet. I implemented an experimental benchmark-only privacy
gateway: password-shaped payloads go through local `phi3`, identified values become
placeholders before leaving the machine, and a deterministic replacement remains as
a fail-safe. Since this is an MIT-licensed synthetic benchmark and the user directed
the test, the full fifty-probe suite, including health-shaped scenarios, was sent
through that gateway. Claude Haiku 4.5 reached `41/50` with `88.7%` expected-content
coverage in `1.06s` average; Claude Sonnet 4.6 reached `45/50` with `91.3%` in
`2.17s`. Sonnet is the quality ceiling so far; Haiku is remarkably close at roughly
half the latency.

The most sobering and useful number was separate: a first keyword-weighted retrieval
pass over the chronological daily-record stream found the correct injected memory in
the top five only `9/50` times. This reframes the build. Better models matter once
given the right fact, but LUCY becomes remarkable only when it builds a brain that
finds that fact after months or years of journal noise. The next work should improve
structured indexing, entity/value memory, and reranking, then repeat answer scoring
on actually retrieved context.

### Opening A Second Remote Comparison Lane

The user also has an OpenAI key and wants to compare its smaller and stronger models
against the same test bench. I added a sibling runner using OpenAI's Responses API
with four general-purpose tiers: `gpt-5.4-nano`, `gpt-5.4-mini`, `gpt-5.4`, and
`gpt-5.5`. The choice is deliberate: LUCY is answering personal-memory questions,
so a general reasoning model is a better baseline than a coding-specialized one.

The runner inherits exactly the Claude benchmark boundary. Before any remote request,
a password-shaped synthetic probe is inspected by local `phi3` and its identified
secret value is substituted; deterministic redaction is still present in case a
small local model misses the obvious value. That allows a provider comparison to be
fair without turning benchmark convenience into a new app-wide privacy policy.

The implementation compiles and all existing validation passes. I did not fabricate
OpenAI numbers: the local environment currently contains the Anthropic test key used
for the completed Claude benchmark, but does not yet contain a fresh `OPENAI_API_KEY`.
Once that local value is added, one command will populate the pending OpenAI rows in
the comparison report.

The user added the OpenAI key using an Expo-prefixed local variable, so I made the
benchmark runner recognize that existing development name while keeping the safer
non-bundle key name as the documented future convention. A two-question smoke run
showed that all four selected Responses API models were accessible, and then the
full fifty-question run completed through the same local-redaction gateway.

The OpenAI result is more interesting than a tidy scale-up story. `gpt-5.4-nano`
scored `41/50`, matching Claude Haiku by pass count, with `86.0%` expected-content
coverage and `1.18s` average latency. `gpt-5.5` scored `34/50`, `gpt-5.4-mini`
scored `27/50`, and `gpt-5.4` scored `26/50`. A larger model should not be declared
inferior from this alone. The current test gives the correct note directly and asks
for a very short literal answer; smaller models may follow that constrained output
style more faithfully while stronger models phrase equivalent answers differently
and lose points under token coverage grading.

This is exactly why the retrieval result matters more. GPT-5.4 Nano is now an
interesting fast remote candidate to carry into the next test, beside Claude Haiku
and Sonnet. But LUCY still found the correct timeline memory only `9/50` times in
its first retrieval baseline. The next improvement is not selecting a winner from a
leaderboard; it is building memory organization and retrieval worthy of those models.

### Turning The Model Choice Into A Phone Beta

The next request shifted from model comparison to a real tester workflow: keep a
local model and GPT-5.4 Nano working together, allow a person to declare that a
thought contains private details, and get something installable onto phones. There
was a tempting shortcut here: bundle the configured API key into the app and let
friends use it. That would make the first demo quick, but an APK is inspectable; a
bundled key becomes a public spending credential. The beta instead asks each tester
for an OpenAI key inside Settings and stores it with the phone's secure storage.

The Capture screen now contains a small `Contains private details` control beneath
the composer. Its decision is recorded separately in the encrypted capture row,
because derived classification can change when models change but a user's explicit
protection request must survive `Reprocess all memories`. This revealed a quiet bug:
the rebuild operation had been resetting all captures to normal. It now restores
private status for user-marked thoughts rather than erasing their choice.

Remote handling also needed honest semantics. The phone cannot run laptop Ollama
`phi3`; it runs one of the ExecuTorch models exposed in Settings, with `Phi-4 Mini
4B` as the nearest Phi-family choice. For a marked or detected private thought, the
selected phone model is asked to produce only a placeholder-bearing sanitized
version. GPT Nano can receive that sanitized version only if masking succeeds; if
the model does not emit a verifiable placeholder result, LUCY uses local processing
instead. Password/card pattern replacement is retained as a second guard. This is a
useful beta experiment, not a security proof, so the UI tells testers to use made-up
private values while it is measured.

Packaging exposed the difference between a development build and a shareable build.
The working tree contains local `.env.local` provider values for experiments, so I
created a clean short-path workspace at `C:\LucyHybridBetaBuild`, excluded every
`.env*` file plus raw benchmark material, generated Android native sources there,
and built an ARM64 release APK with constrained Gradle workers. The first archive
scan command incorrectly treated `.apk` as a PowerShell zip input; I discarded that
result and repeated the inspection through a copied `.zip` archive. The corrected
scan found neither local provider key value in the package.

The ARM64 APK is saved as `dist/LUCY-android-beta-hybrid-arm64.apk` for physical
Android phones. Since the running emulator is x86_64, I built a separate clean
x86_64 APK, installed it, and inspected the live UI: Capture exposes the private
toggle, and Settings exposes `Remote intelligence`, a password-style `OpenAI API
key` field, and `Save key and turn on`. The iPhone version is now an account/signing
step rather than a source-code step: EAS is not logged in on this laptop, and
TestFlight needs the user's Expo session plus Apple Developer signing permission.

### The First Real Phone Feedback: Controls And Keyboard Space

The Android beta immediately found the kind of defect an emulator-only pass often
misses. Settings looked polished, but most of a row was inert; only its tiny `i`
circle opened the sheet. On a phone that feels like a broken feature, not a hidden
interaction rule. I changed each row so its entire information surface opens the
detail sheet, leaving separate immediate action buttons such as `Run` intact.

The more serious problem was capture typing. On the user's phone the keyboard covered
the composer, which makes a memory app unusable at the moment of capture. I first
added standard keyboard avoidance and bottom padding. Live checking showed that it
raised the Settings sheet, but not the Capture composer: padding altered the feed,
while the bottom composing controls still occupied the covered area. The repair now
listens for Android keyboard height and directly lifts the Capture and Ask composer
docks; LUCY also hides its header/navigation while typing so the thought owns the
screen.

Packaging was worth being disciplined about. One attempted refresh accidentally used
the short build folder as both copy source and destination, so I discarded confidence
in that output and recopied from the actual workspace. I then generated and packaged
a fresh x86_64 APK in the key-free build workspace. Emulator inspection confirmed a
full-width `Open Remote intelligence` target and confirmed the protected key field
moves from y=1274 to y=287 when its keyboard activates. Its Capture/Ask input mode
shows only a floating keyboard strip rather than the full keyboard seen on the user's
phone, so that final visual proof belongs on the physical device.

The replacement ARM64 beta was built from the same isolated no-`.env` workspace. It
contains only `arm64-v8a`, verifies with APK Signature Scheme v2 for sideload testing,
and a scan against both local provider secret values found no match. The published
artifact is `dist/LUCY-android-beta-hybrid-arm64.apk`, SHA-256
`EEE3720D26C303627A775269A5CE035D7F118BE498CC0613E4A26F7C0E1DDBD9`.

### The Keyboard Fix That Needed A Fix

The first physical-phone feedback after the usability APK was blunt and valuable:
Settings was finally understandable, but tapping the Capture text field made the
keyboard appear and vanish in a blink. That is worse than a covered composer because
the user cannot ingest a thought at all.

The failed design had two moving pieces triggered by the same keyboard event. The
top-level app removed its branding and tab navigation when the keyboard appeared,
and the Capture/Ask screens translated the focused composer upward. Both are visually
reasonable ideas, but on Android a focused native text control can lose focus when
its React hierarchy or position changes during IME activation. I removed both changes
for ordinary composing. Android now uses its already-configured native `adjustResize`
window behavior; the Settings modal keeps its keyboard handling because that path
was confirmed working.

The user also caught a product clarity issue during this pass: a remote credential
box should not make a tester guess which provider it belongs to. The sheet now says
`OpenAI API key only`, states that LUCY currently calls `GPT-5.4 Nano`, and warns not
to paste Claude or another provider's token into that field.

Packaging brought one more practical lesson. Gradle stalled for an unreasonable time
while only the JavaScript bundle had changed. Rather than publish an unverified stale
APK, I generated a fresh production Hermes bundle without local API-key environment
values, embedded it into the already validated ARM64 native APK, aligned the package,
and re-signed it. The first signature attempt used a different debug certificate and
Android correctly rejected it as an update; I discarded it and used LUCY's project
sideload certificate, matching the existing app signature exactly. An equivalent
x86_64 update then installed over the emulator's retained data. Capture and Ask both
remained focused after one and five seconds with the keyboard invoked, and the new
OpenAI-key instructions rendered in Settings.

The tester APK now published at `dist/LUCY-android-beta-hybrid-arm64.apk` is ARM64
only, v2 signed, scanned with no match for either locally configured provider secret,
and has SHA-256 `A48AD63611E7C152F87E48D60C14B58EE5BF00490DFE68672856CC2F68ACAF18`.
