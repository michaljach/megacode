# Megacode effort comparison — October 3, 2026

**Result: no convincing speed benefit from low effort in this sample.** Both efforts passed every task and check. Low reduced aggregate elapsed time by just **0.39%**, and was faster in only **6/15** matched task/repeat pairs. Its median paired difference was **1.026s slower**. One medium inventory run (123.023s versus 82.262s at low) accounts for much of the aggregate difference. Do not change the default on this evidence alone.

## Setup

- Model: `openai:gpt-6-astra`, using configured ChatGPT subscription credentials / Responses API.
- Five repeats per task and effort; three tasks; **30 total attempts**. Each starts in a fresh workspace, with the same prompt and independent grader.
- For each task, order was medium → low in odd repeats, low → medium in even repeats. Tasks stayed in the same order. Runs were sequential; cache warmth and provider load were not controlled.
- Effort was explicitly passed to the provider in memory. Saved settings were not changed. Other megacode settings/instructions remained configured defaults or user settings; no new isolation of global instructions was introduced.
- Automatic approvals, 240s internal abort, 300s process deadline. No process failures, aborted requests, or timeouts occurred. Tool-level nonzero shell results occurred during log recovery; these are retained in the raw metrics and did not prevent passing the grader.
- Baseline rerun: 0/3 tasks and 1/15 checks, as expected.
- This is a fresh run of the current instrumented code, not a direct reproduction of the older single-run harness comparison. Claude Code/Codex were not rerun in this experiment.

## Aggregate results

| Metric | Medium | Low |
| :--- | ---: | ---: |
| Tasks passed | 15/15 | 15/15 |
| Checks passed | 75/75 | 75/75 |
| Total process wall time | 1,076.706s | 1,072.491s |
| Mean task wall time | 71.780s | 71.499s |
| Median three-task repeat wall time | 214.666s | 214.447s |
| Total model-request time | 1,066.961s | 1,062.970s |
| Model-request share of process time | 99.09% | 99.11% |
| Total tool time | 2.628s | 2.598s |
| Unattributed wall time (startup, logging, etc.) | 7.117s | 6.923s |
| Model steps | 105 | 108 |
| Tool calls | 93 | 100 |
| Reported input tokens | 236,406 | 232,739 |
| Reported output tokens | 20,466 | 20,192 |
| Median first-visible-text latency (text-emitting steps only) | 3.291s | 3.211s |
| Steps with visible text / all steps | 29/105 | 25/108 |

Model-request time includes preparation, streaming, provider retries and text callbacks; it is **not pure server inference time**. First-visible-text latency excludes reasoning/tool-argument streams and is null for tool-only responses, so it must not be averaged as zero. Token accounting is the adapter’s existing input/output accounting; cache usage was not separately recorded.

## Per-task latency distribution

Five attempts per cell. Times are full process wall seconds; all attempts succeeded.

| Task | Medium mean / median / min–max | Low mean / median / min–max |
| :--- | ---: | ---: |
| range-parser | 56.349 / 58.094 / 44.763–66.044 | 61.068 / 62.980 / 55.464–67.141 |
| inventory-transaction | 93.598 / 88.567 / 81.623–123.023 | 88.982 / 88.652 / 82.262–96.914 |
| log-recovery | 65.395 / 66.955 / 61.137–69.513 | 64.448 / 63.397 / 57.290–75.093 |

## Every attempt

Execution order is retained. Durations are seconds; per-model-step and per-tool-call measurements are in the JSON snapshot.

| Repeat | Task | Effort | Checks | Wall | Model | Tools | Steps | Calls |
| ---: | :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | range-parser | medium | 5/5 | 58.094 | 57.466 | 0.141 | 7 | 6 |
| 1 | range-parser | low | 5/5 | 55.889 | 55.359 | 0.126 | 7 | 6 |
| 1 | inventory-transaction | medium | 6/6 | 91.419 | 90.902 | 0.135 | 7 | 6 |
| 1 | inventory-transaction | low | 6/6 | 96.914 | 96.215 | 0.139 | 9 | 8 |
| 1 | log-recovery | medium | 4/4 | 69.513 | 68.760 | 0.228 | 7 | 9 |
| 1 | log-recovery | low | 4/4 | 57.290 | 56.490 | 0.241 | 7 | 6 |
| 2 | range-parser | low | 5/5 | 63.867 | 63.195 | 0.137 | 6 | 6 |
| 2 | range-parser | medium | 5/5 | 62.995 | 62.408 | 0.145 | 7 | 6 |
| 2 | inventory-transaction | low | 6/6 | 88.652 | 88.114 | 0.145 | 7 | 6 |
| 2 | inventory-transaction | medium | 6/6 | 83.356 | 82.634 | 0.122 | 7 | 6 |
| 2 | log-recovery | low | 4/4 | 63.397 | 62.503 | 0.278 | 8 | 7 |
| 2 | log-recovery | medium | 4/4 | 62.371 | 61.539 | 0.267 | 8 | 7 |
| 3 | range-parser | medium | 5/5 | 44.763 | 44.066 | 0.157 | 5 | 4 |
| 3 | range-parser | low | 5/5 | 55.464 | 54.766 | 0.140 | 7 | 6 |
| 3 | inventory-transaction | medium | 6/6 | 88.567 | 88.037 | 0.133 | 7 | 6 |
| 3 | inventory-transaction | low | 6/6 | 86.326 | 85.797 | 0.142 | 7 | 6 |
| 3 | log-recovery | medium | 4/4 | 61.137 | 60.311 | 0.260 | 8 | 7 |
| 3 | log-recovery | low | 4/4 | 65.749 | 65.128 | 0.227 | 7 | 9 |
| 4 | range-parser | low | 5/5 | 67.141 | 66.635 | 0.108 | 7 | 6 |
| 4 | range-parser | medium | 5/5 | 49.847 | 49.165 | 0.140 | 7 | 6 |
| 4 | inventory-transaction | low | 6/6 | 82.262 | 81.734 | 0.138 | 7 | 6 |
| 4 | inventory-transaction | medium | 6/6 | 123.023 | 122.499 | 0.134 | 7 | 6 |
| 4 | log-recovery | low | 4/4 | 75.093 | 74.442 | 0.260 | 8 | 7 |
| 4 | log-recovery | medium | 4/4 | 66.955 | 66.267 | 0.219 | 8 | 7 |
| 5 | range-parser | medium | 5/5 | 66.044 | 65.477 | 0.141 | 7 | 6 |
| 5 | range-parser | low | 5/5 | 62.980 | 62.458 | 0.130 | 7 | 6 |
| 5 | inventory-transaction | medium | 6/6 | 81.623 | 81.081 | 0.153 | 5 | 4 |
| 5 | inventory-transaction | low | 6/6 | 90.755 | 90.228 | 0.134 | 7 | 6 |
| 5 | log-recovery | medium | 4/4 | 66.999 | 66.348 | 0.255 | 8 | 7 |
| 5 | log-recovery | low | 4/4 | 60.712 | 59.908 | 0.251 | 7 | 9 |

## Interpretation and next optimization

Local execution is not the bottleneck here. Even eliminating all measured tool time would save only about **0.24%**. Eliminating all non-model overhead would save under **1%**. Parallelizing local reads alone cannot close the earlier Claude Code gap.

Prioritize fewer model round trips, then measure latency on the same model/backend. Low effort produced slightly more model steps (108 vs 105) and tool calls (100 vs 93), which may offset any per-request benefit; this sample does not establish causation. Keep medium as the default pending broader correctness and latency measurements.

## Reproduce and inspect

```sh
npm run bench -- --model openai:gpt-6-astra --label megacode-effort \
  --effort medium --effort low --repeats 5
```

- [Checked-in metrics snapshot](results/effort-2026-10-03.json): all 30 results, including each model/tool timing, no transcripts or credentials.
- Raw artifacts (gitignored): `.bench/2026-10-03T14-30-34.388Z-megacode-effort/`, including workspaces, transcripts, prompts, grader output, and metrics.
- Baseline: `.bench/2026-10-03T14-58-57.086Z-baseline/results.json`.
