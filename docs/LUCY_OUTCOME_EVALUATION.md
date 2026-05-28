# LUCY Outcome Evaluation

## What We Are Measuring

LUCY should not win because its Ask screen looks like a chatbot or because a model
returns prettier JSON. It should win when remembered life produces useful outcomes
with less effort and stronger privacy.

These are product hypotheses until benchmark results and tester feedback prove them:

| Outcome | Surprising LUCY result to prove | Why a generic chat session may fall short |
| --- | --- | --- |
| Action capture | A casual sentence quietly becomes usable work without a command. | Chat usually waits for an explicit request and does not maintain a durable task state. |
| Time awareness | A buried time commitment surfaces when it matters. | A single conversation is not a scheduled personal memory layer. |
| Spending insights | Casual payment mentions accumulate into a monthly picture. | Users must repeatedly provide history or maintain another tracker. |
| Decisions | LUCY remembers what was decided and can connect later consequences. | Chat responses are not automatically a decision ledger. |
| Ideas | Sensitive ideas are organized without leaving the phone. | High-quality hosted inference usually requires sending content away. |
| Relationships | People, projects, areas, and blockers become a connected mental map. | A generic answer may summarize once without building an evolving graph. |
| Resources and preferences | Repeated interests become future recommendations grounded in the user's life. | General recommendations lack quiet personal accumulation. |
| Updates and completion | `Paid it` or `done` updates the right prior intention instead of becoming noise. | Stateless extraction lacks temporal linking and clarification behavior. |
| Memory questions | Questions yield answers from accumulated context, not just the current prompt. | The user often has to restate the facts. |
| Privacy boundary | Passwords, health details, and confidential ideas remain useful but never remote. | Remote-only quality creates a privacy tradeoff LUCY must avoid. |

## Test Catalog

The executable catalog is in `tests/outcome-catalog.ts`. It contains exactly ten
cases for each outcome, for one hundred total cases:

| Outcome | Count | Execution lane |
| --- | ---: | --- |
| Action capture | 10 | Local model vs Claude |
| Time awareness | 10 | Local model vs Claude |
| Spending insights | 10 | Local model vs Claude |
| Decisions | 10 | Local model vs Claude |
| Ideas | 10 | Local only |
| Relationships | 10 | Local model vs Claude |
| Resources and preferences | 10 | Local model vs Claude |
| Updates and completion | 10 | LUCY end-to-end memory workflow |
| Memory questions | 10 | LUCY end-to-end memory workflow |
| Privacy boundary | 10 | Local only |

This creates three evaluation lanes:

1. `model-comparable`: sixty ordinary synthetic phrases may be evaluated on both the
   local model and Claude for extraction quality and latency.
2. `lucy-end-to-end`: twenty sequences/questions measure memory linking, organization,
   and yielding an answer. These test the product, not one isolated LLM call.
3. `local-only`: twenty idea/privacy fixtures must never be transmitted to a remote
   provider. Their score includes respecting that boundary.

## Repeatable A/B Protocol

Every candidate model or prompt change should record:

| Metric | Meaning |
| --- | --- |
| Correct outcome rate | Cases meeting the expected extraction or end-to-end behavior. |
| Latency | Median and slowest completion time. |
| Privacy violations | Any local-only case routed externally or exposing a credential. Must remain zero. |
| False certainty | Derived connections presented without enough evidence. |
| Battery/storage cost | Local model download size and practical phone processing burden. |

Current commands:

```bash
npm run test:phase1
npm run test:outcome-catalog
```

For the remote safe lane, configure a newly rotated key in `.env.local`, never in a
committed file or distributed build:

```bash
EXPO_PUBLIC_ANTHROPIC_API_KEY=your_rotated_test_key
```

Then run a small cost/connection smoke test:

```bash
set LUCY_AB_LIMIT=5
npm run test:claude-english
```

Remove the limit to run all sixty remote-safe cases. Private idea and credential
cases are excluded from this command by construction.

The local-device lane must run inside LUCY on an actual target device because its
ExecuTorch runtime is native. The existing Settings English model check is the first
small local check; it should be expanded to execute and export the catalog results
before formal model selection.

## Why Not On-Device Claude, And What Can Be Local Instead

Claude is offered by Anthropic as a hosted API model. Anthropic does not publish a
downloadable Claude model package that an iPhone or Android app can embed and execute
offline. Therefore LUCY cannot legally or technically place Claude itself on a phone
using the available product.

There is a better iPhone-specific experiment now: Apple's Foundation Models framework
provides app access to the on-device model behind Apple Intelligence, including guided
generation for structured output. It is available on compatible Apple Intelligence
devices running iOS 26 with Apple Intelligence enabled. That is not Claude, and it
does not solve Android, but it may deliver substantially better local outcomes than
the small cross-platform Qwen tier for eligible iPhone testers.

Even when a downloadable advanced model exists, mobile deployment has hard limits:

- Model weights must fit phone storage and memory.
- Generation must finish fast enough without draining battery or overheating.
- Native runtimes support a narrower set of architectures and quantizations than
  cloud servers.
- Always-on/private background work must share limited operating-system execution time.

The best-outcome design is therefore measurable routing:

- Deterministic code for facts that should be exact and fast, such as explicit
  payments, dates, completions, and retrieval.
- A compact on-device model for protected material and offline use.
- On supported iPhones, an Apple Foundation Models extraction lane to benchmark as a
  stronger private local option.
- An optional remote frontier model for normal material only when the user chooses
  higher quality over complete offline operation.

LUCY should select that balance from benchmark results and tester feedback, not from
the assumption that either local or remote is universally best.

## Provider Comparison Roadmap

| Lane | Device coverage | Privacy boundary | What it tells us |
| --- | --- | --- | --- |
| Current Qwen ExecuTorch | Android and iOS target | Fully local | Cross-platform offline baseline. |
| Qwen3.5 0.8B / 2B ExecuTorch | Android and iOS target | Fully local | Newer local quality tiers exposed for journal testing. |
| Qwen3 4B / Phi-4 Mini 4B ExecuTorch | High-memory target phones | Fully local | Slow, deeper local interpretation candidates for multi-minute journals. |
| Apple Foundation Models | Compatible iPhones on iOS 26 | Fully local | Best private iPhone-quality candidate to test. |
| Claude Haiku/Sonnet API | Any online device through secure backend later | Ordinary data only with consent | Cloud-quality ceiling and latency/cost baseline. |

The first comparison should run the sixty safe model-comparable cases through all
available lanes. The twenty local-only cases run only through on-device lanes. The
twenty multi-memory cases score LUCY's end-to-end outcome independent of whichever
provider extracted the original thoughts.

The Eleanor synthetic benchmark also supports an experimental `Claude after local
redaction` lane. Password/card values are replaced on the local machine with
placeholders before a remote call, and generated response text is not written to the
score file. This is a benchmark experiment, not a blanket change to LUCY's personal
memory privacy rule. Health-shaped Eleanor probes remain excluded remotely unless
the full synthetic/transmission permission is established explicitly.

The currently installed React Native ExecuTorch registry does not expose a DeepSeek
LLM package, and it does not expose a model called `Qwen 3.6`. It does expose
`Qwen3.5 0.8B` and `Qwen3.5 2B`, which are now the closest directly installable
newer Qwen choices for LUCY. A DeepSeek lane would require selecting/exporting a
compatible model runtime or adding a different native engine, then running the same
outcome suite before it can be offered to users.
