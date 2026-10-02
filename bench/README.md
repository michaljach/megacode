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

## Local result (single run)

Backend: ChatGPT subscription / Responses API. Model: `openai:gpt-6-astra`. Reasoning: medium. No harness comparison performed.

| Task | Checks passed | Input tokens | Output tokens | Model steps | Tool calls | Time |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| range-parser | 5/5 | 7,400 | 1,084 | 7 | 6 | 57.8s |
| inventory-transaction | 6/6 | 9,502 | 1,891 | 7 | 6 | 66.9s |
| log-recovery | 4/4 | 27,656 | 1,148 | 8 | 7 | 63.8s |
| **Total** | **15/15** | **44,558** | **4,123** | **22** | **19** | **188.4s** |

Task pass rate: **3/3**. All agent processes exited successfully; no timeout or warning notices. Unmodified baseline: **0/3 tasks**, 1/15 checks (only catalog preservation already passed).

Local raw artifacts: `.bench/2026-10-02T19-19-49.728Z-megacode/results.json`. This measures the current harness, not the token savings versus the pre-optimization version.
