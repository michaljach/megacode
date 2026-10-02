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

`MEGACODE_MODEL` overrides the default model. Switching models mid-conversation keeps the history.

## Interactive UI

| Key                        | Action                                                        |
| -------------------------- | ------------------------------------------------------------- |
| `enter`                    | send (while a turn runs, the message is queued)               |
| `ctrl+s`                   | send queued messages now (interrupts the running turn)        |
| `\` + `enter`, `option+enter` | newline                                                    |
| `↑` / `↓`                  | prompt history (saved in `~/.megacode/history.json`)          |
| `/`                        | commands: `/model`, `/config`, `/mcp`, `/worktree`, `/login`, `/logout`, `/clear`, `/usage`, `/help`, `/exit` |
| `?`                        | shortcut help                                                 |
| `esc`                      | interrupt the running turn, or clear the input                |
| `shift+tab`                | cycle permission mode: ask → accept edits → bypass (default)  |
| `ctrl+a` `ctrl+e` `ctrl+u` `ctrl+k` `ctrl+w` | readline-style editing                      |
| `ctrl+c`                   | interrupt, clear input, or exit (press twice)                 |

## Settings

`/config` opens a menu with every setting; changes apply immediately and are saved to `~/.megacode/settings.json`.

| Setting                    | Default   | Options                                       |
| -------------------------- | --------- | --------------------------------------------- |
| Model                      | –         | opens the model picker                        |
| Permission mode            | bypass    | ask · accept edits · bypass (also the session's current mode) |
| Max steps per turn         | 50        | 25 · 50 · 100 · 200                           |
| Shell command timeout      | 2m        | 30s · 2m · 5m · 10m                           |
| Max tool output            | 30k chars | 10k · 30k · 100k                              |
| Load AGENTS.md / CLAUDE.md | on        | on · off                                      |
| Worktree base              | default branch | default branch (origin/HEAD) · current commit |
| Save prompt history        | on        | on · off                                      |

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

`read_file`, `write_file`, `edit_file`, `bash`, `list_files`, `grep`. Tools run without asking by default (bypass mode; change it in `/config`). `-a/--ask` starts in ask mode, where writes, edits and shell commands open an approval dialog: yes, always for this session, or no (esc), which stops the turn so you can redirect. In one-shot mode with `-a` and no terminal, approvals are refused. If `AGENTS.md` or `CLAUDE.md` exists in the working directory, it is added to the system prompt (unless turned off in `/config`).

## Layout

```
src/
  cli.tsx             entry: flags, TUI or plain mode
  plain.ts            one-shot / piped output
  agent.ts            agent loop: model turn → run tools → repeat (emits events)
  tools.ts            tool definitions + execution
  types.ts            provider-neutral message format
  providers/
    index.ts          "provider:model" resolution, OpenAI-compatible presets
    anthropic.ts      Messages API (streaming)
    openai.ts         Chat Completions (streaming), also used for compatible APIs
    chatgpt.ts        Sign in with ChatGPT + Responses API adapter
    gemini.ts         @google/genai (streaming)
  ui/                 Ink (React) TUI
    App.tsx           transcript, streaming, approvals, model picker, shortcuts
    PromptInput.tsx   multi-line editor, history, slash menu
    Select.tsx        arrow-key list
    ModelPicker.tsx   searchable live model list
    LoginDialog.tsx   provider login flow
    ConfigMenu.tsx    /config settings menu
    WorktreeMenu.tsx  /worktree menu, exit prompt
    McpMenu.tsx       /mcp server list, add wizard, details
    format.ts         Markdown rendering, tool labels
  config.ts           ~/.megacode: auth.json, settings.json, history.json
  worktree.ts         git worktree create / list / status / remove
  mcp.ts              MCP client: ~/.megacode/mcp.json, connections, tools
  oauth.ts            PKCE, local callback server, browser launch
  login.ts            OpenRouter OAuth, Anthropic CLI login
```

Conversation history is stored in a neutral format (`types.ts`). Each assistant turn also keeps the provider's native content. That content is sent back verbatim to the same provider, so Anthropic thinking blocks and Gemini thought signatures are preserved. When you switch providers, the next one gets the neutral text and tool calls instead.

To add a provider, implement `Provider.turn()` in `src/providers/` and register it in `providers/index.ts`.

## Development

```sh
npm install
npm start               # runs src/cli.tsx via tsx
npm test                # tool safety and OAuth regression tests
npm run typecheck
npm run build           # compiles to dist/, which is what gets published
```
