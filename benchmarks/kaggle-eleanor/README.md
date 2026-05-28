# Eleanor Vance Longitudinal Benchmark

This benchmark is isolated from LUCY's live memory. The local source ZIP contains:

- `1,460` daily records spanning `December 1, 2020` through `November 30, 2024`
- `50` manual injection probes with an injected note, question, and expected response content

## Why It Is Useful

Unlike a single-capture extraction test, this dataset can exercise long-term recall,
completion tracking, changing priorities, health/context sensitivity, and questions
whose answer depends on a remembered fact.

## Safety Lane

The archive includes password-shaped testing entries, health material, and
relationship content. The user confirmed on `2026-05-26` that the passwords are
made-up benchmark facts rather than real credentials. Therefore:

- The raw ZIP and extracted JSON are ignored by git.
- It must not be imported into a user's LUCY memory database.
- It is local-only by default and must not be submitted to Claude or any external
  model comparison runner until the full corpus is confirmed synthetic and a
  deliberate remote-test subset is reviewed.
- Remote testing requires a confirmed dataset source/license and a deliberate review
  that the selected fixture content is safe to transmit.

The user confirmed on `2026-05-26` that the Kaggle dataset is published under the
MIT license and that its password values are made-up test inputs. The ZIP itself
does not contain a license file, so its Kaggle source URL should still be recorded
before publishing redistributed fixtures or benchmark results. This corpus remains
a valuable privacy test: LUCY should protect password-shaped memory even when a
particular benchmark secret is fictional.

## Local Validation

Place `kaggle_dataset.zip` at the app root and extract its JSON files to:

```text
benchmarks/kaggle-eleanor/raw/
```

Then run:

```powershell
npm run test:kaggle-eleanor
```

The validator reads the local JSON and prints aggregate coverage only. It does not
print memory text, import records into LUCY, or call a model.

## Local Model Comparison

The first model scorecard is an `oracle-memory` evaluation: it gives each local
model one injected remembered fact together with its test question. This measures
answering quality once the correct memory has been retrieved; it does not yet
measure LUCY's long-term retrieval across all daily records.

Run all locally installed comparison models:

```powershell
npm run bench:kaggle-eleanor:models
```

Limit a quick trial or select particular Ollama models:

```powershell
$env:ELEANOR_LIMIT='10'
$env:ELEANOR_MODELS='phi3,qwen3.6'
npm run bench:kaggle-eleanor:models
```

The run sends nothing to the internet and stores sanitized result metadata under
the git-ignored `results/` directory. Generated answer text is not stored.

### Claude After Local Redaction

For synthetic benchmark comparison only, LUCY can prepare an outbound payload
locally. The benchmark uses local `phi3` on password-shaped probes to identify secret
values and replace them with placeholders such as `[LOCAL_SECRET_1]`. A deterministic
fallback still blocks labeled password/card values if the small model misses them.
Claude sees the placeholder, not the local value, and the sanitized score file stores
no generated answer text.

Health-shaped probes remain excluded from this remote lane by default. With a newly
rotated Anthropic test key in `.env.local`, run:

```powershell
$env:ELEANOR_LIMIT='10'
npm run bench:kaggle-eleanor:claude
```

To run the same fifty-probe synthetic suite through both configured remote models,
including synthetic health-shaped probes by explicit benchmark permission:

```powershell
$env:ELEANOR_LIMIT='50'
$env:ELEANOR_REMOTE_INCLUDE_HEALTH='true'
$env:ELEANOR_CLAUDE_MODELS='claude-haiku-4-5-20251001,claude-sonnet-4-6'
npm run bench:kaggle-eleanor:claude
```

### OpenAI After Local Redaction

The same oracle-memory benchmark is available through OpenAI's Responses API. The
default comparison includes low-cost, mid-tier, and flagship lanes:

- `gpt-5.4-nano`
- `gpt-5.4-mini`
- `gpt-5.4`
- `gpt-5.5`

Add a fresh `OPENAI_API_KEY` only to local `.env.local`, then run:

```powershell
$env:ELEANOR_LIMIT='50'
$env:ELEANOR_REMOTE_INCLUDE_HEALTH='true'
$env:ELEANOR_PRIVACY_MODEL='phi3'
$env:ELEANOR_OPENAI_MODELS='gpt-5.4-nano,gpt-5.4-mini,gpt-5.4,gpt-5.5'
npm run bench:kaggle-eleanor:openai
```

This uses the same local `phi3` password redaction and deterministic fail-safe as the
Claude benchmark. Result files contain aggregate and per-probe scores only, not model
answer text.

The runner accepts the existing local `EXPO_PUBLIC_OPENAI_API_KEY` variable for
development compatibility. `OPENAI_API_KEY` is preferred for future benchmark setup
because this credential must never be bundled in a distributed mobile app.

This redacted benchmark route is intentionally separate from normal LUCY capture
processing. It demonstrates a privacy gateway before any decision to offer such an
opt-in route for personal memories.

## Timeline Memory Evaluation

The outcome-oriented benchmark adds daily records and manual injected memories in
chronological order. For each question, it retrieves only memories that LUCY could
have known at that point in time, then optionally asks a local model to answer from
the recalled context.

Test retrieval without waiting on model generation:

```powershell
$env:ELEANOR_SKIP_MODEL='true'
npm run bench:kaggle-eleanor:timeline
```

Test answer quality with a runnable local Ollama model:

```powershell
$env:ELEANOR_MODEL='phi3'
$env:ELEANOR_LIMIT='10'
Remove-Item Env:ELEANOR_SKIP_MODEL -ErrorAction SilentlyContinue
npm run bench:kaggle-eleanor:timeline
```

This is the first benchmark for LUCY's actual brain behavior: recalling the right
fact from accumulated memories before a model formulates an answer.

## Planned Scorecard

This corpus should become a second, realistic lane after the controlled outcome
catalog:

1. Ingest daily entries chronologically in an isolated benchmark database.
2. Ask manual-injection questions only after their recorded injection date.
3. Compare expected and retrieved content locally, including whether sensitive
   answers stay protected.
4. Measure memory retrieval and organization quality separately from single-note
   extraction quality.
