# Harness benchmark v1

A dependency-free coding **smoke benchmark**, not a comprehensive agent ranking. Three fixed tasks exercise parsing/validation, atomic updates/immutability, and recovering a defect from long tool output and a long source file. Each starts in a fresh workspace with the same files and prompt. Grading uses 15 checks defined in `tasks.ts`, outside the workspace and written only after the agent exits. Agents are asked to add and run their own tests; the correctness score itself uses the independent grader, not agent-written tests.

## Latest: same-model gateway comparison

**[HTML report](report.html)** · [Full same-model results](gateway-comparison.md) · [Metrics snapshot](results/gateway-2026-10-03.json)

Both harnesses used **GPT-6 Astra, medium effort, the same local gateway and OAuth account**, with five repeats per task and alternating harness order. Both passed **15/15 tasks and 75/75 checks**. Mean three-task suite time: **megacode 219.257s**, **Claude Code 206.237s** (5.94% less aggregate time in this sample). All 30 attempts and configuration caveats are retained; the earlier cross-model comparison remains historical, not merged into these results.

With the [gateway installed](gateway.md), reproduce using `python3 bench/compare-gateway.py`.

## Run megacode

```sh
npm install
npm run bench -- --baseline                     # verify broken fixtures fail
npm run bench -- --model openai:gpt-6-astra      # one pass over all three tasks
npm run bench -- --model openai:gpt-6-astra --repeats 5
npm run bench -- --model openai:gpt-6-astra --task log-recovery
```

The model defaults to megacode's configured model. Each task gets a new Agent, automatic tool approvals, a 240s abort signal and a 300s process deadline. The grader has a 30s deadline. Results, prompts, transcripts, workspaces and grading output are saved in ignored `.bench/<timestamp>-<label>/` directories. `results.json` includes task/check pass rates, exit status, timeout, elapsed time, and megacode's reported cumulative input/output tokens, model steps and tool calls. Token counts include repeated context; they are not unique context size or dollar cost. Anthropic input totals now include uncached, cache-read and cache-creation tokens, with components recorded per step; older snapshots may use the previous uncached-only accounting. Do not silently mix historical accounting schemes. `MEGACODE_CONFIG_DIR` selects an isolated configuration for the built-in benchmark agent; `BENCH_AGENT_TIMEOUT_MS` overrides its internal abort (the gateway comparison uses 300000 to match the process deadline).

## Per-step timing and effort comparisons

**[Five-repeat medium/low results](effort-comparison.md)** · [Per-step metrics snapshot](results/effort-2026-10-03.json). Both passed 15/15 task attempts and 75/75 checks; low was only 0.39% faster in aggregate. Approximately 99.1% of wall time was inside model requests. This effort experiment is separate from the single-run cross-harness comparison.

```sh
npm run bench -- --model openai:gpt-6-astra --label megacode-effort \
  --effort medium --effort low --repeats 5
```

This runs 30 fresh task attempts: three tasks × two efforts × five repeats. For each task, effort order alternates by repeat (medium/low, then low/medium). `--effort` overrides the agent's configured effort in memory only; it never edits saved settings. Use explicit model and effort values for reproducibility. Effort flags are rejected for external/baseline runs rather than silently mislabeling them.

Each built-in run's `metrics.json` (also embedded in `results.json`) includes:

- `modelTimings`: one entry per model step, with one-based `step`, monotonic `durationMs`, `firstTextMs`, completion/error/abort `status`, and reported input/output `usage` when available. Model duration includes request preparation, provider retries, streaming, and text callbacks—not only server inference. First-text latency measures the first nonempty **visible text**, not the first network byte, reasoning token, or tool argument. Tool-only responses have `firstTextMs: null`.
- `toolTimings`: step, call ID/name, relative start, duration, and error flag for each tool. Duration includes the tool-start checkpoint overhead and any approval wait (benchmark approval is immediate); it excludes final result logging. Interrupted calls without an end callback retain null duration/error fields.
- `elapsedMs`: time since agent construction completed, excluding process startup and module loading. The runner's top-level `elapsedMs` is the full process wall time; use that for end-to-end comparisons.
- `finished`: whether the benchmark's finally block ran. Metrics are checkpointed between events so hard-killed runs can retain partial data; an in-flight model request killed by the process deadline will not have a completed timing record. Don't count missing durations as zero.

Per-step usage follows the provider adapter. Anthropic now records `inputBreakdown` and a cache-inclusive input total, plus the backend's `responseModel` in model timing records. The earlier medium/low snapshot retains its original ChatGPT-adapter accounting. Report every attempt, errors and timeouts as well as correctness, and compare runtimes on successful attempts separately. Repeated trials still do not control provider load or cache warmth.

## Run another harness on exactly the same tasks

**[Local GPT-6 Astra gateway setup](gateway.md)** — installed `claude-astra` launcher, isolated from `claude-jach`, with verified text and tool round trips. The [completed same-model comparison](gateway-comparison.md) includes commands, all attempts, and configuration caveats.

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

**[View the HTML comparison report](report.html)** — a standalone, responsive snapshot with runtime and input-token charts, task-level results, and methodology notes. Open it locally with `open bench/report.html` on macOS (or in any browser). No server or external dependencies are required. The report is a static snapshot of the results below, not automatically regenerated by the runner.

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

### Three-harness comparison: Claude Code via `claude-jach`

On **2026-10-03**, the benchmark was rerun using the `claude-jach` alias's configuration: `CLAUDE_CONFIG_DIR=~/.claude-jach claude --dangerously-skip-permissions`. Claude Code **2.1.288** resolved `opus` to **`claude-opus-5-5`**, with medium effort on the first-party backend. All three tasks passed, all processes exited 0, and no timeouts occurred.

| Harness / model | Tasks passed | Checks passed | Total time | Reported input tokens | Output tokens |
| :--- | ---: | ---: | ---: | ---: | ---: |
| megacode / GPT-6 Astra | 3/3 | 15/15 | 188.4s | 44,558 | 4,123 |
| Codex / GPT-6 Astra | 3/3 | 15/15 | 230.3s | 222,445 | 4,732 |
| Claude Code / Opus 5.5 | 3/3 | 15/15 | 78.481s | 136,366 | 7,925 |

| Claude Code task | Checks | Time | Uncached input | Cache creation | Cache reads | Total input | Output |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| range-parser | 5/5 | 22.512s | 6 | 13,284 | 22,684 | 35,974 | 2,181 |
| inventory-transaction | 6/6 | 29.773s | 6 | 5,255 | 32,125 | 37,386 | 3,233 |
| log-recovery | 4/4 | 26.196s | 10 | 5,262 | 57,734 | 63,006 | 2,511 |
| Total | 15/15 | 78.481s | 22 | 23,801 | 112,543 | 136,366 | 7,925 |

Claude token counts come from each transcript's final native `result.usage` event. Total input adds `input_tokens`, `cache_creation_input_tokens`, and `cache_read_input_tokens` exactly once; external `results.json` metrics remain `null`. Provider tokenizers and accounting differ, so these are not directly comparable efficiency measures or dollar costs. Native CLI turn counts are not equated with megacode model steps.

**This compares model and harness together**, not harness alone: Claude uses Opus while the other two use GPT-6 Astra. It is one completed run per task, on different dates with uncontrolled cache warmth. Configured setting sources, hooks, slash-command skills, and MCP servers were disabled, but built-in plugins (including agents-md) remained present and auto-memory/instruction discovery were not explicitly disabled. The same fixtures, prompts, grader, and 300s deadline were used, with automatic approvals and no sandbox. The initial billing-blocked profile attempt is retained below, not included in completed-run chart totals.

Reproduce the alias profile without relying on interactive-shell alias expansion:

```sh
CLAUDE_CONFIG_DIR="$HOME/.claude-jach" npm run bench -- --model opus --label claude-jach --command '["/Users/jach/.local/bin/claude","--print","--model","opus","--effort","medium","--dangerously-skip-permissions","--no-session-persistence","--setting-sources","","--settings","{\"disableAllHooks\":true}","--disable-slash-commands","--strict-mcp-config","--mcp-config","{\"mcpServers\":{}}","--output-format","stream-json","--verbose"]'
```

### Claude Code / Opus initial attempt (blocked)

On **2026-10-03**, Claude Code **2.1.288** was run once on each of the same three tasks, with medium effort. The `opus` alias resolved to **`claude-opus-5-5`**. Every attempt exited with code 1 and the API billing error **“Credit balance is too low”**, before doing task work. No timeouts occurred.

| Task | Status | Process elapsed | Unchanged-fixture checks |
| :--- | :--- | ---: | ---: |
| range-parser | Billing error | 2.069s | 0/5 |
| inventory-transaction | Billing error | 2.219s | 0/6 |
| log-recovery | Billing error | 2.377s | 1/4 |

These are **blocked attempts, not performance results**. The 0/3 task pass rate and 1/15 checks describe unchanged baseline fixtures, not Claude's coding ability. Times measure startup and API rejection. Native result events report zero tokens and empty `modelUsage`; external runner metrics remain `null`. The HTML report discloses the attempt but excludes it from performance charts. The successful `claude-jach` rerun above compares **model and harness together**, since the other harnesses used GPT-6 Astra.

Invocation (substitute your executable path; requires funded Claude Code credentials):

```sh
npm run bench -- --model opus --label claude-code --command '["/Users/jach/.local/bin/claude","--print","--model","opus","--effort","medium","--dangerously-skip-permissions","--no-session-persistence","--setting-sources","","--settings","{\"disableAllHooks\":true}","--disable-slash-commands","--strict-mcp-config","--mcp-config","{\"mcpServers\":{}}","--output-format","stream-json","--verbose"]'
```

Configured setting sources, hooks, slash-command skills, and MCP servers were disabled; session persistence was disabled. Built-in plugins remained present in initialization events; auto-memory and CLAUDE.md discovery were not explicitly disabled. Permissions were bypassed, with the same 300s process deadline, prompts, fixtures, and independent grader. No task work occurred because of the billing error.

Local raw artifacts (gitignored):

- Claude Code (`claude-jach`, completed): `.bench/2026-10-03T12-23-53.988Z-claude-jach/results.json` (with native JSONL `transcript.txt` and independent `grade.txt` per task)

- Claude Code (blocked): `.bench/2026-10-03T12-06-20.581Z-claude-code/results.json` (with native JSONL `transcript.txt` and independent `grade.txt` per task)
- megacode: `.bench/2026-10-02T19-19-49.728Z-megacode/results.json`
- Codex: `.bench/2026-10-02T19-42-20.817Z-codex/results.json` (with per-task `transcript.txt` and `grade.txt` alongside the workspaces)
