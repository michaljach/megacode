# Harness benchmark v1

A dependency-free coding **smoke benchmark**, not a comprehensive agent ranking. Three fixed tasks exercise parsing/validation, atomic updates/immutability, and recovering a defect from long tool output and a long source file. Each starts in a fresh workspace with the same files and prompt. Grading uses 15 checks defined in `tasks.ts`, outside the workspace and written only after the agent exits. Agents are asked to add and run their own tests; the correctness score itself uses the independent grader, not agent-written tests.

## Run megacode

```sh
npm install
npm run bench -- --baseline                     # verify broken fixtures fail
npm run bench -- --model openai:gpt-6-astra      # one pass over all three tasks
npm run bench -- --model openai:gpt-6-astra --repeats 5
npm run bench -- --model openai:gpt-6-astra --task log-recovery
```

The model defaults to megacode's configured model. Each task gets a new Agent, automatic tool approvals, a 240s abort signal and a 300s process deadline. The grader has a 30s deadline. Results, prompts, transcripts, workspaces and grading output are saved in ignored `.bench/<timestamp>-<label>/` directories. `results.json` includes task/check pass rates, exit status, timeout, elapsed time, and megacode's reported cumulative input/output tokens, model steps and tool calls. Token counts include repeated context; they are not unique context size or dollar cost. Cached-input accounting varies by provider (in particular, the existing Anthropic usage counter excludes cache reads/writes); do not compare provider accounting schemes directly.

## Run another harness on exactly the same tasks

Supply a JSON argv array; the runner appends the **identical prompt as the final argument**, runs in the fresh workspace, and exports `BENCH_MODEL`. Use an absolute executable/wrapper path when necessary:

```sh
npm run bench -- --model openai:gpt-6-astra --label other \
  --command '["/absolute/path/to/other-harness-wrapper"]' --repeats 5
```

Example wrapper (adapt options to your harness):

```sh
#!/bin/sh
# "$1" is the benchmark prompt. Pick the exact same model explicitly.
exec your-agent --model gpt-6-astra --non-interactive --auto-approve "$1"
```

`--model` is only metadata for external commands: **the wrapper must actually select that model**. External token usage is deliberately `null`; collect it from the harness/API's native usage report, not from transcript length. The transcript and elapsed time are captured automatically. The runner invokes argv directly, not through a shell.

For a fair comparison:

- Match exact model/version, provider/backend, reasoning effort, permissions, and time limits. This repository's ChatGPT adapter uses `medium` reasoning effort.
- Disable unrelated user/global instructions, plugins, persistent memory and background agents, or disclose them. Start a fresh conversation for every task; the runner gives each a fresh workspace.
- Run at least 5 repeats, alternating harness order. Record caching policy/warmth and compare correctness first, then tokens/runtime on successful tasks.
- Report all attempts, including failures/timeouts; don't cherry-pick. No cross-harness claim is supported by one megacode run.
- These are small synthetic tasks. Follow with real repository tasks or a standard suite such as SWE-bench before making quality claims.

**Security:** this is not a sandbox. Tools run with your user's permissions and inherited credentials, just like the CLI in bypass mode. Use a container or disposable account for untrusted models/harnesses. Full transcripts and temporary output logs can contain sensitive data. `.bench/` is gitignored. The grader is separated to avoid accidental discovery, not secured against an agent deliberately searching outside its workspace.

## Local comparison (one run per harness)

Run date: 2026-10-02. Both harnesses used the ChatGPT subscription / Responses API backend, model `gpt-6-astra`, and medium reasoning. Codex CLI version: `0.153.0`. The megacode results are the existing run; Codex was run afterward on the same fixtures and prompts with the same independent grader.

### At a glance

> **Single-run smoke comparison, not a leaderboard.** Both harnesses solved all three tasks. Cache warmth was not controlled, and input tokens include cached context—not dollar cost.

| Harness | Tasks passed ↑ | Checks passed ↑ | Total time ↓ | Input tokens¹ | Output tokens | Runs per task |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| **megacode** | **3/3 (100%)** | **15/15** | 188.4s | 44,558 | 4,123 | 1 |
| **Codex** | **3/3 (100%)** | **15/15** | 230.3s | 222,445 | 4,732 | 1 |

↑ Higher is better · ↓ Lower is better · **—** Not reported (not zero). Totals use unrounded timings.

In these runs, megacode used **18.2% less elapsed time** and reported **80.0% fewer input tokens** than Codex, with the same check pass count. These are observations from this sample, not expected speed or cost savings.

### Task-by-task comparison

Each task groups the same metrics side by side; add a harness column for future comparisons.

| Task | Metric | megacode | Codex |
| :--- | :--- | ---: | ---: |
| **range-parser** | Checks passed ↑ | **5/5** | **5/5** |
| | Time ↓ | 57.8s | 60.6s |
| | Input tokens¹ | 7,400 | 60,997 |
| | Output tokens | 1,084 | 1,253 |
| **inventory-transaction** | Checks passed ↑ | **6/6** | **6/6** |
| | Time ↓ | 66.9s | 100.6s |
| | Input tokens¹ | 9,502 | 74,837 |
| | Output tokens | 1,891 | 2,206 |
| **log-recovery** | Checks passed ↑ | **4/4** | **4/4** |
| | Time ↓ | 63.8s | 69.1s |
| | Input tokens¹ | 27,656 | 86,611 |
| | Output tokens | 1,148 | 1,273 |

### Harness-specific diagnostics

These counters are not standardized across harnesses; missing values are deliberately left blank of any inferred count.

| Harness | Model steps | Tool calls | Cached input tokens¹ | Timeouts |
| :--- | ---: | ---: | ---: | ---: |
| megacode | 22 | 19 | — | 0 |
| Codex | — | — | 195,840 | 0 |

¹ Input includes repeated context and any reported cached input. Codex's cached input is included in its total; megacode did not record cache usage separately. Token totals do not establish relative cost.

For future harnesses, add a row to the summary and diagnostics and a column to the task comparison. Record the version, backend, model, reasoning settings, and repeat count alongside each comparison; use **—** for unavailable metrics rather than estimating them.

Both task pass rates: **3/3**. All agent processes exited successfully, with no timeouts. Codex reported no error/failed events. Unmodified baseline: **0/3 tasks**, 1/15 checks (only catalog preservation already passed). Totals use unrounded timings.

Codex tokens come from the native JSONL `turn.completed.usage` events in each `transcript.txt`; external `results.json` metrics remain `null`. Input includes cached tokens: Codex reported 52,608 / 65,408 / 77,824 cached input tokens respectively (**195,840 total**, included in 222,445). Megacode did not separately record cache usage. Model steps and tool calls are left unreported for Codex rather than equating its CLI turn/item events with megacode's counters.

Reproduce the Codex invocation (substitute your executable path):

```sh
npm run bench -- --model openai:gpt-6-astra --label codex \
  --command '["/Users/jach/.local/bin/codex","exec","--ignore-user-config","--ignore-rules","--ephemeral","--skip-git-repo-check","--dangerously-bypass-approvals-and-sandbox","--model","gpt-6-astra","-c","model_reasoning_effort=\"medium\"","-c","project_doc_max_bytes=0","--json"]'
```

Codex ignored user configuration and execpolicy rules, disabled project instruction loading, and used a fresh ephemeral session per task. Both harnesses ran with automatic approvals and without a sandbox. Both had a 300s process deadline; megacode additionally has a 240s internal abort. Neither limit was reached. Other Codex built-in defaults were retained. Cache warmth was not controlled; these were sequential single runs, not five alternating repeats. **This is a smoke comparison, not evidence of a general speed, cost, or quality advantage.** Token totals are not dollar costs, and this does not measure savings versus the pre-optimization megacode version.

Local raw artifacts (gitignored):

- megacode: `.bench/2026-10-02T19-19-49.728Z-megacode/results.json`
- Codex: `.bench/2026-10-02T19-42-20.817Z-codex/results.json` (with per-task `transcript.txt` and `grade.txt` alongside the workspaces)
