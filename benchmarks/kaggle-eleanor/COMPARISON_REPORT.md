# Eleanor Benchmark Comparison Report

Run date: `2026-05-27`

## Oracle Memory Answering

This test provides each model the correct injected memory and asks its associated
question. It measures answer quality after retrieval, not LUCY's ability to find the
memory in a long timeline.

| Model | Location | Passed | Coverage | Average Time |
| --- | --- | ---: | ---: | ---: |
| Claude Sonnet 4.6 | Remote, after local redaction | 45 / 50 | 91.3% | 2.17s |
| Claude Haiku 4.5 | Remote, after local redaction | 41 / 50 | 88.7% | 1.06s |
| OpenAI GPT-5.4 Nano | Remote, after local redaction | 41 / 50 | 86.0% | 1.18s |
| OpenAI GPT-5.5 | Remote, after local redaction | 34 / 50 | 77.4% | 1.46s |
| OpenAI GPT-5.4 Mini | Remote, after local redaction | 27 / 50 | 68.4% | 1.09s |
| Phi-3 | Laptop local Ollama | 26 / 50 | 68.2% | 10.20s |
| OpenAI GPT-5.4 | Remote, after local redaction | 26 / 50 | 70.0% | 1.17s |
| Qwen 2.5 1.5B | Laptop local Ollama | 13 / 50 | 42.6% | 2.91s |
| Qwen 3.6 | Laptop local Ollama | Not runnable | Not scored | Requires 24.3 GiB RAM; only about 12.5 GiB available during check |

The Claude run used the complete `50`-probe synthetic benchmark, including its
health-shaped scenarios at the user's explicit direction. On password-shaped input,
local `phi3` performed redaction before any Claude request; a deterministic fallback
also remained enabled. Sanitized results store scores and timing only, not generated
answer text.

The OpenAI run used the same `50` prepared probes and the same local-redaction
boundary. The unexpectedly strong `gpt-5.4-nano` result should be read narrowly: the
task asks for an exact short answer from already supplied memory, so concise prompt
compliance can outperform broader reasoning behavior. It is not yet a ranking for
multi-memory interpretation or retrieval.

## Timeline Retrieval Baseline

The harder product test exposes available daily memories chronologically and asks
whether the correct injected memory can be retrieved before a model answers.

| Retrieval Method | Result |
| --- | ---: |
| Initial keyword-weighted top-5 retrieval | 9 / 50 target memories found |

## Interpretation

- Remote Claude materially improves answer formulation once the correct memory is
  available; Sonnet is the current quality ceiling and Haiku is close while faster.
- In this narrow oracle-answer task, GPT-5.4 Nano matches Haiku by pass count and is
  worth testing after retrieval improves; larger OpenAI tiers require prompt/eval
  investigation before drawing quality conclusions.
- The current retrieval baseline is the main bottleneck. Sending poor context to a
  stronger model will not make LUCY feel intelligent.
- The next benchmark increment should improve memory indexing and retrieval, then
  rerun timeline answer quality with local `phi3`, Haiku, Sonnet, and GPT-5.4 Nano.
