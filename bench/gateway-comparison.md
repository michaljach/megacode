# Same-model harness comparison — October 3, 2026

**Both harnesses passed every check. Claude Code used 5.94% less aggregate wall time in this sample.** Unlike the earlier Opus-versus-GPT smoke test, both harnesses used **GPT-6 Astra at medium effort through the same local gateway**. This is a harness/configuration comparison on small synthetic tasks, not a general ranking.

## Protocol and controls

- Five repeats × three tasks × two harnesses = **30 attempts**, all retained. Fresh workspace and conversation for every attempt; identical prompts, fixtures, and independent grader.
- Each task pairs the harnesses: megacode first on odd repeats, Claude Code first on even repeats. Task order is fixed. No concurrent benchmark runs.
- Both send Anthropic Messages to `http://127.0.0.1:8317`, translated by **CLIProxyAPI 8.0.13** to the ChatGPT/Codex Responses backend. One OAuth account, no model aliases, gateway retry rounds disabled. Every recorded backend model identity was **gpt-6-astra**.
- Gateway policy pins **medium effort** and automatic reasoning summaries. It is verified unchanged before each attempt. Source hashes are verified unchanged across attempts and saved in the JSON snapshot.
- **Claude Code 2.1.288**, via isolated `claude-astra`, in **bare mode**, which disables normal profile hooks, auto-memory and CLAUDE.md auto-discovery. Slash-command skills and MCP servers were empty in initialization events; no session persistence, automatic tool approvals. Default model aliases/subagents map to GPT-6 Astra. **Built-in `agents-md` and `plugin-authoring` plugins still appeared in initialization events**; their internal behavior/instruction injection was not audited. Bare mode is not a guarantee that all built-in extensions are absent.
- **Megacode** uses its Anthropic adapter with an isolated empty configuration/skills directory for each attempt. Project instruction loading and prompt autocomplete disabled; 50-step cap, 120s shell timeout, 12k-character tool output cap, automatic approvals. No MCP connections are started by this benchmark entry point.
- Both have a **300s process deadline**. Megacode’s internal abort is also 300s for this experiment. Grader timeout: 30s. No sandbox; normal user permissions.
- Harness-native system prompts, tools, batching decisions, client retries, and context/output handling remain different. Claude’s custom-model fallback context limits and bare mode are disclosed configuration differences. This does not measure stock Claude Code’s default full-feature configuration.
- Cache warmth and provider load were not controlled. One upstream model identifier is matched, not an immutable server-weight snapshot. Gateway translation is part of both measurements.

## Aggregate results

| Metric | megacode | Claude Code |
| :--- | ---: | ---: |
| Task attempts passed | 15/15 | 15/15 |
| Independent checks passed | 75/75 | 75/75 |
| Agent errors / process timeouts | 0 / 0 | 0 / 0 |
| Total process wall time (15 tasks) | 1,096.283s | 1,031.186s |
| Mean three-task suite time (5 repeats) | 219.257s | 206.237s |
| Median three-task suite time | 219.496s | 206.783s |
| Mean task wall time | 73.086s | 68.746s |
| Total input tokens (cache-inclusive) | 264,818 | 172,110 |
| Output tokens | 20,629 | 21,612 |
| Cache-read input tokens (included above) | 153,472 | 73,856 |
| Cache-creation input tokens (included above) | 0 | 0 |
| Tool calls | 98 | 45 |
| Model steps (megacode only) | 107 | — |
| CLI turns (Claude only; not equated to model steps) | — | 60 |

Claude Code was faster in **11/15 matched task/repeat pairs** and **4/5 three-task repeats**. Its median paired task difference was **4.419s faster**. Aggregate reduction: `(1096.283 − 1031.186) / 1096.283 = 5.94%`. These observations do not establish a general or statistically reliable advantage from five repeats.

### Where time went

- Megacode model-request time: **1,086.858s (99.14% of process time)** across 107 steps. Measured tool time: **2.572s**. Remaining **6.853s** includes startup, logging, checkpoints and other overhead.
- Claude Code native reported API time: **1,012.917s**. This is its own timing definition, not guaranteed identical to megacode’s instrumentation.
- Claude Code made 45 tool calls versus megacode’s 98, consistent with more batching. Call counts and these observational timings do not prove the cause of the latency difference. Inspect transcripts before attributing savings to a specific implementation.
- Prioritize reducing unnecessary model round trips, not parallelizing local file reads alone. All local tool time combined accounts for only about **0.23%** of megacode wall time in this run.

### Token accounting

Megacode’s Anthropic adapter was corrected before this run: input now includes uncached + cache-read + cache-creation tokens, with the components recorded per model step. Claude counts come from each final native `result.usage` event using the same sum. Gateway translation separates cache tokens from uncached input, so add each component once. The checked-in snapshot keeps both normalized usage and available diagnostics.

External runner `metrics` remain null for Claude; native diagnostics are stored separately, not estimated from transcript length. Token counts are repeated context, not unique context or dollar costs. Claude’s custom-model price estimates have unknown cost basis and are deliberately omitted. Older snapshots retain their original accounting and must not be silently reinterpreted.

## Per-task latency

Each row contains five successful attempts per harness; times are full process wall seconds.

| Task | megacode mean / median / min–max | Claude mean / median / min–max |
| :--- | ---: | ---: |
| range-parser | 60.196 / 61.524 / 54.640–62.568 | 55.169 / 51.666 / 49.432–64.580 |
| inventory-transaction | 93.780 / 91.659 / 84.605–102.460 | 87.393 / 87.862 / 80.550–93.710 |
| log-recovery | 65.280 / 66.096 / 60.531–67.387 | 63.676 / 61.905 / 61.541–69.489 |

## Three-task suite totals by repeat

| Repeat | First harness in each pair | megacode | Claude Code |
| ---: | :--- | ---: | ---: |
| 1 | megacode | 225.489s | 206.783s |
| 2 | Claude Code | 231.103s | 214.608s |
| 3 | megacode | 207.249s | 220.195s |
| 4 | Claude Code | 219.496s | 195.843s |
| 5 | megacode | 212.946s | 193.757s |

## Every attempt (execution order)

| Repeat | Task | Harness | Checks | Wall seconds | Input tokens | Output tokens | Tool calls |
| ---: | :--- | :--- | ---: | ---: | ---: | ---: | ---: |
| 1 | range-parser | megacode | 5/5 | 60.136 | 10,147 | 1,057 | 6 |
| 1 | range-parser | claude-code | 5/5 | 49.432 | 4,886 | 1,029 | 2 |
| 1 | inventory-transaction | megacode | 6/6 | 99.257 | 12,690 | 1,925 | 6 |
| 1 | inventory-transaction | claude-code | 6/6 | 87.862 | 5,719 | 2,008 | 2 |
| 1 | log-recovery | megacode | 4/4 | 66.096 | 27,684 | 1,149 | 9 |
| 1 | log-recovery | claude-code | 4/4 | 69.489 | 26,646 | 1,242 | 5 |
| 2 | range-parser | claude-code | 5/5 | 59.401 | 4,665 | 1,190 | 2 |
| 2 | range-parser | megacode | 5/5 | 62.568 | 10,896 | 1,142 | 6 |
| 2 | inventory-transaction | claude-code | 6/6 | 91.656 | 7,390 | 1,991 | 3 |
| 2 | inventory-transaction | megacode | 6/6 | 102.460 | 13,057 | 2,022 | 6 |
| 2 | log-recovery | claude-code | 4/4 | 63.551 | 19,530 | 1,222 | 4 |
| 2 | log-recovery | megacode | 4/4 | 66.075 | 27,348 | 1,113 | 7 |
| 3 | range-parser | megacode | 5/5 | 62.113 | 10,831 | 1,117 | 6 |
| 3 | range-parser | claude-code | 5/5 | 64.580 | 6,973 | 1,146 | 3 |
| 3 | inventory-transaction | megacode | 6/6 | 84.605 | 12,399 | 1,717 | 6 |
| 3 | inventory-transaction | claude-code | 6/6 | 93.710 | 9,602 | 2,102 | 3 |
| 3 | log-recovery | megacode | 4/4 | 60.531 | 31,981 | 1,068 | 7 |
| 3 | log-recovery | claude-code | 4/4 | 61.905 | 28,460 | 1,204 | 5 |
| 4 | range-parser | claude-code | 5/5 | 50.764 | 5,311 | 1,087 | 2 |
| 4 | range-parser | megacode | 5/5 | 61.524 | 11,041 | 1,130 | 6 |
| 4 | inventory-transaction | claude-code | 6/6 | 83.185 | 5,812 | 1,922 | 2 |
| 4 | inventory-transaction | megacode | 6/6 | 91.659 | 12,578 | 1,886 | 6 |
| 4 | log-recovery | claude-code | 4/4 | 61.894 | 18,091 | 1,242 | 4 |
| 4 | log-recovery | megacode | 4/4 | 66.313 | 32,549 | 1,173 | 7 |
| 5 | range-parser | megacode | 5/5 | 54.640 | 10,748 | 1,008 | 6 |
| 5 | range-parser | claude-code | 5/5 | 51.666 | 5,467 | 1,128 | 2 |
| 5 | inventory-transaction | megacode | 6/6 | 90.919 | 12,605 | 1,909 | 6 |
| 5 | inventory-transaction | claude-code | 6/6 | 80.550 | 5,476 | 1,853 | 2 |
| 5 | log-recovery | megacode | 4/4 | 67.387 | 28,264 | 1,213 | 8 |
| 5 | log-recovery | claude-code | 4/4 | 61.541 | 18,082 | 1,246 | 4 |

## Reproduce and inspect

With the [local gateway](gateway.md) installed, authenticated, and running:

```sh
python3 bench/compare-gateway.py
```

The driver runs all 30 attempts sequentially, alternates order, sets isolated megacode configurations, and checks that source/configuration has not changed. It reads the private local client key into child environments; no secrets are written to result snapshots. It stops on runner infrastructure failure or source/policy changes instead of silently continuing a different experiment.

- [Full metrics snapshot](results/gateway-2026-10-03.json): all attempts, normalized usage, per-step megacode timings, native Claude diagnostics, sanitized gateway policy, versions, and source hashes.
- [HTML report](report.html): primary same-model results, with older cross-model figures retained separately.
- Raw comparison manifest: `.bench/2026-10-03T18-53-01.604Z-gateway-comparison/results.json`.
- Per-attempt workspaces, transcripts, prompts, and independent grader output are in the snapshot’s `artifactDirectory` paths. Raw files are gitignored; full transcripts may contain sensitive data.
- No Codex CLI rerun was included in this experiment. `claude-jach` was not used or modified.
