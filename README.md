# megacode

A minimal coding agent harness for multiple providers and models. It uses the official Anthropic, OpenAI and Google GenAI SDKs. Requires Node ≥ 22.14.

```sh
npm install -g @megacode/cli

megacode                         # interactive TUI
megacode "fix the failing test"  # one-shot, plain output
cat error.log | megacode "why does this fail?"
megacode -m openai:gpt-5
megacode -m gemini:gemini-2.5-pro
megacode -m ollama:qwen3:8b
megacode -m openrouter:anthropic/claude-sonnet-5
megacode -w                      # work in a new git worktree
megacode -w fix-auth "fix login" # named worktree, one-shot
```

## Automatic updates

Global npm installations check for a new stable release in the background when the interactive UI launches. Updates install silently without interrupting the session; a dim **Reopen to install update · v…** line appears below the prompt when ready. Reopen megacode to run the new version. Offline checks and installation failures are ignored and retried on a future launch.

Set `MEGACODE_DISABLE_AUTO_UPDATE=1` to opt out. Development checkouts, linked/local installs, one-shot commands, and Windows installations are not automatically updated. To update manually, run `npm install -g @megacode/cli@latest` (also use this if your global npm directory requires elevated permissions; megacode never requests sudo).

## Providers

Run `/login` to connect a provider. Where a provider supports browser sign-in, it's offered first:

| Provider   | Sign-in options                                                                 |
| ---------- | ------------------------------------------------------------------------------- |
| OpenAI     | **Sign in with ChatGPT** (uses your Plus/Pro/Business plan), or an API key      |
| OpenRouter | **Sign in with OpenRouter** (OAuth; creates a key for megacode), or an API key  |
| Anthropic  | API key, or **Anthropic CLI** (`ant auth login`, which the SDK picks up)        |
| Others     | API key, or a server URL for Ollama / LM Studio / custom endpoints              |

Credentials are verified (by fetching the model list) and saved to `~/.megacode/auth.json` (mode 600). ChatGPT tokens refresh automatically. `/logout` removes saved credentials. On first run with nothing configured, the login dialog opens by itself. An environment variable, if set, takes precedence over anything saved. Set `$BROWSER` to control how sign-in URLs are opened; the URL is also shown in the dialog.

"Sign in with ChatGPT" uses the same OAuth client and backend as OpenAI's Codex CLI. That backend isn't a documented public API, so it may change without notice. Claude Pro/Max subscriptions can't be used: Anthropic doesn't permit third-party tools to use Claude.ai logins.

`/model` lists every model from every connected provider, fetched live. Type to filter, then press enter. Anything unlisted can be used as `provider:model`. The last model you pick is remembered.

| Provider     | Env                                       | Notes                            |
| ------------ | ----------------------------------------- | -------------------------------- |
| `anthropic`  | `ANTHROPIC_API_KEY`                       | default: `claude-opus-5`         |
| `openai`     | `OPENAI_API_KEY`                          | default: `gpt-5`                 |
| `gemini`     | `GEMINI_API_KEY`                          | default: `gemini-2.5-pro`        |
| `openrouter` | `OPENROUTER_API_KEY`                      | OpenAI-compatible                |
| `groq`       | `GROQ_API_KEY`                            | OpenAI-compatible                |
| `deepseek`   | `DEEPSEEK_API_KEY`                        | OpenAI-compatible                |
| `ollama`     | –                                         | `localhost:11434`                |
| `lmstudio`   | –                                         | `localhost:1234`                 |
| `compat`     | `OPENAI_COMPAT_BASE_URL`, `OPENAI_COMPAT_API_KEY` | any other OpenAI-compatible server |

`MEGACODE_MODEL` overrides the default model. Switching models mid-conversation keeps the history. `MEGACODE_CONFIG_DIR` moves everything megacode saves (credentials, settings, history, MCP servers) out of `~/.megacode`.

## Interactive UI

When the model needs clarification, it can call `ask_questions` to open an interactive questionnaire (up to eight questions). Choose a suggested answer with arrow keys and Enter, or choose **Other** to type your own; questions without options accept text directly. Review all answers before submitting, or start over. **Esc** or **Ctrl+C** cancels and interrupts the turn without submitting partial answers. Questions always require your input, even in bypass mode. In one-shot/plain mode, the tool tells the model to ask in text instead of waiting for an interactive form.

Code changes look like Claude Code's: edits show one line-number column, removed lines in red on a red band and added lines in green on a green band (the changed words brighter), with plain context around them; new files list their lines. Code is drawn in one color, without syntax highlighting, and code blocks in replies stay plain.

Successful `edit_file` and `write_file` calls show persistent diffs in the conversation in every permission mode, including automatically accepted edits, under a summary such as "Added 2 lines, removed 1 line". Ask-mode approvals use the same view; overwriting a file shows both removals and additions. Previews are limited to 60 diff rows (the first 10 lines for a new file in the conversation), long lines wrap under the code, and files too large to compare show a notice instead. These are previews of built-in file tools, not a live Git diff viewer (shell/MCP edits aren't tracked).

| Key                        | Action                                                        |
| -------------------------- | ------------------------------------------------------------- |
| `enter`                    | send (while a turn runs, the message is queued)               |
| `ctrl+s`                   | send queued messages now (interrupts the running turn)        |
| `\` + `enter`, `option+enter` | newline                                                    |
| `↑` / `↓`                  | prompt history (saved in `~/.megacode/history.json`)          |
| `/`                        | commands: `/model`, `/effort`, `/config`, `/mcp`, `/skills`, `/worktree`, `/login`, `/logout`, `/clear`, `/usage`, `/help`, `/exit` |
| `?`                        | shortcut help                                                 |
| `esc`                      | interrupt the running turn, or clear the input                |
| `shift+tab`                | cycle permission mode: ask → accept edits → bypass (default)  |
| `ctrl+a` `ctrl+e` `ctrl+u` `ctrl+k` `ctrl+w` | readline-style editing                      |
| `ctrl+c`                   | interrupt, clear input, or exit (press twice)                 |

## Settings

`/effort` opens an effort picker, or use `/effort low`, `/effort medium`, `/effort high`, or `/effort default` directly. The selection is saved to `~/.megacode/settings.json` and applies starting with the next turn (including future sessions). `default` preserves provider defaults (medium for ChatGPT). Explicit levels use OpenAI's reasoning effort, Anthropic's output effort, or Gemini's thinking level (Gemini 3) / token budget (1,024 / 8,192 / 24,576 for older models). Not every model or compatible server supports these controls or every level; use `default` if the provider rejects the setting.

`/config` opens a settings menu; changes apply immediately and are saved to `~/.megacode/settings.json`.

| Setting                    | Default   | Options                                       |
| -------------------------- | --------- | --------------------------------------------- |
| Model                      | –         | opens the model picker                        |
| Permission mode            | bypass    | ask · accept edits · bypass (also the session's current mode) |
| Max steps per turn         | 50        | 25 · 50 · 100 · 200                           |
| Shell command timeout      | 2m        | 30s · 2m · 5m · 10m                           |
| Max tool output            | 12k chars | 6k · 12k · 30k · 100k                         |
| Load AGENTS.md / CLAUDE.md | on        | on · off                                      |
| Worktree base              | default branch | default branch (origin/HEAD) · current commit |
| Save prompt history        | on        | on · off                                      |
| Prompt autocomplete       | on        | on · off                                      |

Prompt autocomplete suggests a next prompt based on the current conversation and recent tool results, displayed as dimmed inline text after a turn finishes. **Tab** accepts without sending; **Enter** sends only text you've entered or accepted. Typing a different prompt hides the suggestion. Suggestions use an additional, tool-free request to the selected model (normal provider costs apply, tokens count toward `/usage`); they never execute actions or change conversation history. Failures silently leave the prompt unchanged. Toggle **Prompt autocomplete** in `/config`, or set `"promptAutocomplete": false` in `~/.megacode/settings.json` to disable requests and suggestions. Slash-command completion remains available independently.

## Skills

Skills are reusable instructions in a `SKILL.md` file, optionally accompanied by scripts, references, or other assets. Install from a local directory or a GitHub repository:

```sh
megacode skills install ./my-skill
megacode skills install owner/repository
megacode skills install https://github.com/owner/repository --global
megacode skills list
```

In the TUI, use `/skills` to list skills and `/skills install <source> [--global]` to install them. Local paths containing spaces can be quoted. No provider login is required for the standalone CLI commands.

- Installs go to `.megacode/skills/<name>` in the current working directory, or `~/.megacode/skills/<name>` with `--global`. Project skills override global skills with the same name. Worktrees use their own working directory's skills.
- A source can be a single skill directory or a repository containing multiple skills; all discovered skills are installed. GitHub installs require Git and clone the default branch. Branch/subdirectory URLs and non-GitHub remotes aren't supported. Private repositories require existing Git credentials; installation doesn't prompt for login.
- Installed metadata is available starting with the next turn. The agent reads a skill's full instructions only when relevant or requested by name. `/skills` also reports invalid installed skills, which are skipped during discovery.
- Existing installs are never overwritten. To remove or reinstall a skill, remove its installation directory first. Installs are copies, not links; source changes aren't automatically synced.
- **Only install skills you trust.** Installation copies files but never runs skill scripts. Skills can instruct the agent to run commands later, under the session's normal permissions. Symlinks and special files are rejected; `.git`, `node_modules`, and `.megacode` are excluded. Each skill is limited to 50 MiB and 10,000 entries.

A skill needs YAML frontmatter with a unique lowercase, hyphenated name (up to 64 characters) and a description (up to 1,024 characters):

```markdown
---
name: review-tests
description: Review test coverage and suggest missing regression tests.
---
Read the changed code and its tests. Identify missing regression coverage.
Consult references/checklist.md when needed.
```

## MCP servers

`/mcp` lists your [MCP](https://modelcontextprotocol.io) servers with their status and tools, and lets you add, reconnect, disable or remove them. Servers are saved in `~/.megacode/mcp.json`, in the same format Claude Code and Claude Desktop use, so existing entries can be pasted in:

```json
{
  "mcpServers": {
    "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/projects"] },
    "github": { "command": "github-mcp-server", "args": ["stdio"], "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "…" } },
    "docs": { "type": "http", "url": "https://example.com/mcp", "headers": { "Authorization": "Bearer …" } }
  }
}
```

- Transports: `stdio` (local command; it inherits your environment plus `env`), `http` (streamable HTTP) and `sse`. Add `"disabled": true` to keep a server configured but off.
- Servers connect in the background at startup; failures are reported and shown in `/mcp`. Tools that servers add or remove while running are picked up.
- Tools appear to the model as `mcp__<server>__<tool>` and go through the same approval as shell commands (asked in ask / accept-edits mode, automatic in bypass). Server instructions are added to the system prompt.
- Not supported yet: OAuth sign-in for remote servers (use a header with a token), project-level `.mcp.json`, and MCP resources and prompts.

## Worktrees

Like Claude Code, megacode can work in a separate git worktree so the agent's changes stay off your checkout. Worktrees live in `<repo>/.megacode/worktrees/<name>` (hidden from `git status`) on a branch named `worktree-<name>`, branched from the remote's default branch or your current commit (see `/config`).

- `megacode -w [name]` starts in a worktree, creating it if needed (random name if omitted). The argument after `-w` is taken as the name if it looks like one (letters, digits, `-`, `_`); otherwise it's part of the prompt.
- `/worktree` opens a menu to create a worktree, switch between them, or return to the main checkout (keeping or removing the worktree). `/worktree <name>` switches directly.
- Exiting while in a worktree asks whether to keep it or remove it along with its branch, showing any uncommitted files and unmerged commits that removal would discard.
- In one-shot mode there's no one to ask: a worktree created by that run and left untouched is removed; anything else is kept.

## Tools

`read_file`, `view_image`, `write_file`, `edit_file`, `bash`, `list_files`, `grep`. `view_image` sends local PNG, JPEG, GIF, or WebP files (up to 5 MiB) to a vision-capable model, so you can provide a screenshot path without attaching it manually. Tools run without asking by default (bypass mode; change it in `/config`). `-a/--ask` starts in ask mode, where writes, edits and shell commands open an approval dialog: yes, always for this session, or no (esc), which stops the turn so you can redirect. In one-shot mode with `-a` and no terminal, approvals are refused. If `AGENTS.md` or `CLAUDE.md` exists in the working directory, it is added to the system prompt (unless turned off in `/config`).

### Token-efficient context

File reads default to 200 lines and a 12,000-character budget, with an exact continuation offset. Lines are never silently cut (a single oversized line can exceed the budget). Scope searches and read only the ranges you need.

Long shell, search, listing and MCP results show the first and last halves of the "Max tool output" budget (12,000 characters by default, so 6,000 each; see `/config`). Full output is saved in a private `megacode-output-*` directory under the OS temporary directory, with a path the agent can read/search. Exit status stays visible, and a non-zero exit marks the result as an error. These logs may contain sensitive command output; remove them when no longer needed (they are not automatically deleted by megacode). Listings capped at 1,000 entries explicitly request a narrower glob.

Conversation history, project instructions, and provider-native reasoning/signatures are retained until the conversation nears the model's context window. Existing provider prompt caching remains enabled where supported.

### Automatic compaction

When the conversation no longer fits the model's context window, megacode compacts it: the model writes a summary of the conversation so far (requests, decisions, files and commands, errors, current state, next steps), the summary replaces the history, and the work continues. Two things trigger it:

- **Before a request,** when the previous request used 80% of the model's context window. This needs the window size, which comes from the Anthropic and Gemini model APIs, the ChatGPT backend, and servers that report it in their model list (OpenRouter's `context_length`, vLLM's `max_model_len`). At the start of a turn it runs before your new message is added, so your message is sent word for word.
- **When the provider rejects a request as too long** (any provider, including plain OpenAI keys, which don't publish window sizes): megacode compacts and retries that request once.

The summary is written from a plain-text transcript that keeps the first message and as much of the latest history as fits (long text and tool output are shortened in the middle); if even that is too long for the model, it tries again with less. Compaction shows as two notices in the transcript, and its tokens count toward usage. Compaction loses detail: anything the summary leaves out is gone from the model's context (your terminal scrollback keeps everything). If the history still doesn't fit after compacting, the turn ends with an error; run `/clear` to start over.

## Layout

The code follows a ports-and-adapters layout with one dependency rule: `core/` imports nothing outside itself, `adapters/` implement core's ports, and `ui/` sits on top. `composition.ts` is the only place that wires adapters into the core.

```
src/
  cli.tsx             entry: flags, TUI or plain mode
  args.ts             command-line parsing
  composition.ts      composition root: builds the Agent from adapters
  core/               domain and use cases; no SDKs, I/O or UI
    agent.ts          agent loop: model turn → run tools → repeat (emits events)
    conversation.ts   provider-neutral message format
    provider.ts       Provider port, turn request/result, effort, "provider:model" specs
    tools.ts          Tool and ToolSource ports, approvals, questionnaires
    settings.ts       settings, defaults, permission modes
    prompts.ts        system prompt composition, compaction and suggestion prompts
    compaction.ts     summarizing the history when it nears the context window
    elide.ts          shortening long text in the middle
    suggestion.ts     next-prompt suggestions
  adapters/
    storage.ts        JSON files in the config folder (~/.megacode or $MEGACODE_CONFIG_DIR)
    settings.ts       settings.json
    project.ts        working directory and AGENTS.md / CLAUDE.md for the system prompt
    accounts.ts       /login and /logout use cases: verify, save, remove credentials
    skills.ts         skill discovery and installation
    update.ts         background automatic updates for global npm installs
    providers/
      catalog.ts      known providers and OpenAI-compatible presets
      credentials.ts  credential precedence (env, saved, ChatGPT, local, ant profile)
      registry.ts     provider factory and cache, model lists, model resolution
      anthropic.ts    Messages API (streaming)
      openai.ts       Chat Completions (streaming), also used for compatible APIs
      chatgpt.ts      Responses API adapter for ChatGPT sign-in
      gemini.ts       @google/genai (streaming)
      shared.ts       tool-argument parsing, fallback call ids, data URLs
      usage.ts        /usage: account limits and balances
    auth/
      store.ts        auth.json
      oauth.ts        PKCE, local callback server, browser launch
      chatgpt.ts      Sign in with ChatGPT, token refresh, usage API
      openrouter.ts   OpenRouter OAuth
      anthropic.ts    Anthropic CLI login and profile detection
    tools/
      index.ts        built-in ToolSource: lookup, validation, error handling
      validation.ts   argument checks from each tool's JSON schema
      files.ts        read / write / edit / list files
      image.ts        view_image: bounded read, format detection
      shell.ts        bash, grep
      questions.ts    ask_questions tool and input validation
      output.ts       output budgets, temp-file spill, paged file reads
    mcp/
      manager.ts      MCP connections, offered to the agent as a ToolSource
      config.ts       mcp.json, server drafts, command-line splitting
      transport.ts    stdio / HTTP / SSE transports
      results.ts      tool results as text
    git/worktree.ts   git worktree create / list / status / remove
  lib/async.ts        withTimeout
  lib/fs.ts           pathExists, the async existsSync
  lib/plural.ts       "1 line", "3 lines"
  lib/cycle.ts        wrap-around list index
  ui/                 Ink (React) TUI and plain output
    App.tsx           layout and wiring: session, dialogs, prompt, command context
    commands.ts       slash command registry (name, description, handler)
    session.ts        AgentSession: turns, queue, interrupts, approvals, questionnaires (no React)
    shortcuts.ts      app-level keyboard shortcuts as data (ctrl+c, esc, ctrl+s, shift+tab, …)
    plain.ts          one-shot / piped output
    hooks/
      useAgentSession.ts     React binding for AgentSession
      useTranscript.ts       finished transcript items, notices, /clear
      useSettingsActions.ts  model, effort, settings and login/logout changes
      useStreamedText.ts     streamed-text buffering
      usePromptSuggestion.ts next-prompt suggestions
      useWorktree.ts         entering and leaving worktrees
      useLoaded.ts           run a promise once on mount
    components/       Dialog (the frame every dialog uses), Select, TextField, KeyList, Spinner, Waiting
    transcript/       ItemView (one finished entry), ToolResult, AssistantText, RunningTool, CallHeader,
                      TranscriptRow, DiffLines
    prompt/           PromptArea (input, status line, help), PromptInput, PromptText, StatusLine,
                      QueuedMessages, Help; editing.ts (cursor moves), history.ts, autocomplete.ts
    dialogs/
      ActiveDialog.tsx    renders the dialog a command opened
      ApprovalDialog.tsx  tool permission prompt
      Questionnaire.tsx   ask_questions form
      model/              ModelPicker (searchable live model list), modelRows.ts (filtering, login rows)
      EffortPicker.tsx    /effort menu
      config/             ConfigMenu (/config), entries.ts (each setting and its choices)
      login/              LoginDialog, LogoutDialog, useLogin (the flow), loginFlow.ts (steps, errors)
      mcp/                McpMenu, ServerList, ServerDetails, RemoveServer, AddServerWizard,
                          mcpWizard.ts (steps, validation), status.ts
      worktree/           WorktreeMenu, ExitWorktreeDialog
    text/             shared by the TUI and plain output
      diff.ts         diff model: rows, word-level changes, plain-text rendering
      markdown.ts     Markdown → ANSI, safe flush points for streamed text
      format.ts       tool labels, previews, change summaries
test/                 node:test suites (npm test); e2e.test.mjs runs the CLI against a fake model server
bench/
  run.ts, tasks.ts     task runner, fixtures, and independent grading
  megacode.ts          instrumented agent entry point: per-step and tool timings
  compare-gateway.py   paired five-repeat runs through the installed local gateway
  report.html          standalone benchmark charts and results
  results/             sanitized metrics snapshots; raw artifacts stay in ignored .bench/
```

Conversation history is stored in a neutral format (`core/conversation.ts`). Each assistant turn also keeps the provider's native content. That content is sent back verbatim to the same provider, so Anthropic thinking blocks and Gemini thought signatures are preserved. When you switch providers, the next one gets the neutral text and tool calls instead.

Tools return structured results; a file edit reports the change (`file`, `before`, `after`), and only the UI turns it into a colored diff, so nothing display-only reaches the model.

To add a provider, implement the `Provider` port (`core/provider.ts`) in `src/adapters/providers/`, add it to `catalog.ts`, and construct it in `registry.ts`. To add a tool source, implement `ToolSource` (`core/tools.ts`) and combine it in `composition.ts`.

## Harness benchmark

See [bench/README.md](bench/README.md) for fixed coding tasks, independent grading, and reproducible comparisons. Open [bench/report.html](bench/report.html) locally for the charts, or read the [five-repeat same-model gateway comparison](bench/gateway-comparison.md).

```sh
npm run bench -- --model openai:gpt-6-astra --repeats 5
npm run bench -- --model openai:gpt-6-astra --effort medium --effort low --repeats 5
```

Repeated `--effort` flags alternate effort order between repeats without changing saved settings. Per-step metrics include model duration, first-visible-text latency, backend model identity where reported, usage, and tool duration. `MEGACODE_CONFIG_DIR` isolates benchmark settings; `BENCH_AGENT_TIMEOUT_MS` overrides the built-in agent's 240s abort (the process deadline remains 300s). See the benchmark guide for timing definitions and caveats.

Anthropic input usage now includes uncached, cache-read, and cache-creation tokens. Historical benchmark snapshots retain their original accounting; tokens represent repeated context, not dollar cost.

## Development

```sh
npm install
npm start               # runs src/cli.tsx via tsx
npm test                # unit and UI rendering tests in test/
npm run typecheck
npm run build           # compiles to dist/, which is what gets published
```
