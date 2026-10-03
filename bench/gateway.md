# Local GPT-6 Astra gateway for Claude Code

## Status (2026-10-03)

Installed and verified on this machine. **`claude-jach` was not changed.**

```text
claude-astra (Claude Code, separate profile)
  → http://127.0.0.1:8317/v1/messages
  → CLIProxyAPI 8.0.13 (Anthropic ↔ Codex Responses translation)
  → OpenAI ChatGPT/Codex backend, gpt-6-astra
```

The gateway has its own Codex OAuth grant, completed using browser sign-in. Existing megacode, Codex, and `claude-jach` token files were not copied or modified. The device-code attempt timed out before the browser login succeeded.

**Live checks passed:**

- No-tool request through `claude-astra`: returned exactly `OK` (2.842s CLI duration).
- Tool round trip: Claude Code called `Read` on a temporary file and returned its random contents correctly (8.096s CLI duration). This exercises streamed tool arguments, tool results, and a subsequent model response.
- Native CLI result events identified `gpt-6-astra`; there are no model aliases or alternate upstream accounts in this gateway configuration.
- Listener confirmed on **127.0.0.1 only**, not a LAN address. Local API key required.
- These are connectivity checks, **not benchmark results**. The subsequent [same-model benchmark](gateway-comparison.md) completed 30 attempts: both harnesses passed all 75 checks, and Claude used 5.94% less aggregate time in that sample.

## Use

```sh
claude-astra
claude-astra --print 'Reply with exactly OK.'

megacode-gateway status
megacode-gateway stop
megacode-gateway start
megacode-gateway login          # browser OAuth, if reauthentication is needed
megacode-gateway device-login   # optional device-code alternative
```

Both launchers are in `~/.local/bin`, already on this machine's PATH. `claude-astra` starts the gateway if necessary. There is no login/startup service and no shell RC modification; the process remains running until stopped or the machine restarts.

`claude-astra` uses a separate **`~/.claude-astra`** profile, local-only API credentials, and Claude Code's **bare mode**. It skips normal profile credential lookup, hooks, auto-memory and instruction auto-discovery; slash-command skills and MCP servers are disabled. Opus/Sonnet/Haiku defaults and the subagent model all point to GPT-6 Astra. Explicit benchmark permission/output flags can be passed on the command line. Unlike `claude-jach`, this launcher does **not** bypass tool permissions by default.

**Reasoning effort is pinned to medium at the gateway**, including auxiliary requests. Supplying `--effort low` to the CLI does not override that gateway policy. For a low-effort experiment, change the gateway policy deliberately, restart it, and record the new configuration for both harnesses. The gateway also requests automatic reasoning summaries.

## Files and security

| Location | Purpose |
| :--- | :--- |
| `~/.local/bin/claude-astra` | Isolated Claude Code launcher |
| `~/.local/bin/megacode-gateway` | Start/stop/status and OAuth login helper |
| `~/.local/share/megacode-gateway/v8.0.13/` | Pinned binary, license, upstream README and example config |
| `~/.config/megacode-gateway/config.yaml` | Private gateway configuration (JSON, a YAML subset) |
| `~/.config/megacode-gateway/client-key` | Random local client key; not an OpenAI/Anthropic API key |
| `~/.config/megacode-gateway/auth/` | Separate OpenAI OAuth tokens |
| `~/.config/megacode-gateway/gateway.log` | Local process log |
| `~/.config/megacode-gateway/smoke.json` | No-tool connectivity result |
| `~/.config/megacode-gateway/tool-smoke.jsonl` | Tool round-trip result |
| `~/.claude-astra/` | Isolated Claude Code configuration/history |

Credential/config files have mode 600 and containing directories mode 700. Management endpoints/control-panel downloads, LAN discovery, gateway retry rounds, bootstrap retries, and debug/request-body logging are disabled. Embedded model catalogs are used (`-local-model`) rather than remote catalog updates. Official-client header cloaking is disabled. Only one upstream credential is configured, avoiding account rotation. CLI/client retries and cache behavior can still affect measurements.

Gateway code is third-party software running locally and necessarily handles its own OpenAI tokens and model traffic. No hosted relay was configured. This is not a complete security audit or a guarantee that the gateway never makes ancillary network requests; keep logs private, especially error/login logs. Do not commit tokens, local keys, or full transcripts. Claude Code's displayed `costUSD` for this custom model has `costBasis: unknown` and is **not** an actual subscription charge.

Installed artifact:

- [CLIProxyAPI v8.0.13](https://github.com/router-for-me/CLIProxyAPI/releases/tag/v8.0.13)
- `CLIProxyAPI_8.0.13_darwin_aarch64.tar.gz`
- SHA-256 verified against the GitHub release asset digest: `652a192e3e38520253e330c4a094fa8916728370c3f213f127dbc56e35be7938`
- Binary reports version 8.0.13, commit `d7914afd`.

## Reproduce the same-model harness comparison

The [completed comparison](gateway-comparison.md) used this driver, which alternates harness order, isolates megacode settings, sets both deadlines to 300s, and saves every attempt:

```sh
python3 bench/compare-gateway.py
```

The individual commands below are illustrative, not a replacement for those controls.

Route **both harnesses through the same gateway Messages endpoint**, not Claude through the translator versus megacode's previous direct Responses route. The `anthropic:` prefix below chooses the wire protocol adapter; the upstream model remains GPT-6 Astra.

Proposed megacode invocation from the repository root:

```sh
megacode-gateway start
ANTHROPIC_BASE_URL=http://127.0.0.1:8317 \
ANTHROPIC_API_KEY="$(cat "$HOME/.config/megacode-gateway/client-key")" \
  npm run bench -- --model anthropic:gpt-6-astra --effort medium \
  --label megacode-astra-gateway --repeats 5
```

Claude Code invocation (substitute the executable path for another machine):

```sh
npm run bench -- --model gpt-6-astra --label claude-astra-gateway --repeats 5 \
  --command '["/Users/jach/.local/bin/claude-astra","--print","--dangerously-skip-permissions","--no-session-persistence","--output-format","stream-json","--verbose"]'
```

These commands describe each arm; **alternate harness order per repeat**, rather than running both five-repeat blocks back-to-back, for the actual comparison. Keep all attempts, independent grading, deadlines, exact gateway version/config, and model identity in the report. Align project/global instruction loading with Claude's bare mode, and disclose remaining harness-specific prompts/tools. Do not apply normal Claude Code context/output-limit assumptions to GPT without checking them; this CLI currently reports fallback limits for the unrecognized model.

Megacode's Anthropic adapter was corrected before the same-model run to count uncached + cache-read + cache-creation input tokens, with components retained in per-step metrics. Claude counts are normalized from its final native usage event using the same sum. Older snapshots retain their original accounting. A gateway route is a new experiment, not directly comparable to the old direct-backend latency figures. Claude bare mode still reported built-in agents-md and plugin-authoring plugins; their internal behavior was not audited, so do not assume all built-in features were disabled.

Anthropic's [gateway documentation](https://code.claude.com/docs/en/llm-gateway) explicitly does not support routing Claude Code to non-Claude models. This setup works in the checks above but remains an experimental integration, not an officially supported Claude configuration.

## Stop or remove

Run `megacode-gateway stop` before removing its launchers or directories. The paths in the table are dedicated to this installation; removing them does not require editing `claude-jach`. Revoke the gateway's separate OpenAI authorization if you no longer want it to have access. Keep `~/.claude-astra` if you want to retain its history.
