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
| `\` + `enter`, `option+enter` | newline                                                    |
| `↑` / `↓`                  | prompt history (saved in `~/.megacode/history.json`)          |
| `/`                        | commands: `/model`, `/login`, `/logout`, `/clear`, `/usage`, `/help`, `/exit` |
| `?`                        | shortcut help                                                 |
| `esc`                      | interrupt the running turn, or clear the input                |
| `shift+tab`                | cycle permission mode: ask → accept edits → bypass            |
| `ctrl+a` `ctrl+e` `ctrl+u` `ctrl+k` `ctrl+w` | readline-style editing                      |
| `ctrl+c`                   | interrupt, clear input, or exit (press twice)                 |

## Tools

`read_file`, `write_file`, `edit_file`, `bash`, `list_files`, `grep`. Writes, edits and shell commands open an approval dialog: yes, always for this session, or no (esc), which stops the turn so you can redirect. `-y/--yolo` starts in bypass mode. In one-shot mode without a terminal, approvals are refused unless `-y` is given. If `AGENTS.md` or `CLAUDE.md` exists in the working directory, it is added to the system prompt.

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
    format.ts         Markdown rendering, tool labels
  config.ts           ~/.megacode: auth.json, settings.json, history.json
  oauth.ts            PKCE, local callback server, browser launch
  login.ts            OpenRouter OAuth, Anthropic CLI login
```

Conversation history is stored in a neutral format (`types.ts`). Each assistant turn also keeps the provider's native content. That content is sent back verbatim to the same provider, so Anthropic thinking blocks and Gemini thought signatures are preserved. When you switch providers, the next one gets the neutral text and tool calls instead.

To add a provider, implement `Provider.turn()` in `src/providers/` and register it in `providers/index.ts`.

## Development

```sh
npm install
npm start               # runs src/cli.tsx via tsx
npm run typecheck
npm run build           # compiles to dist/, which is what gets published
```
