# AGENTS.md

Instructions for coding agents (megacode, Claude Code, Codex, …) working in this repository.

megacode (`@megacode/cli`) is a minimal multi-provider coding agent for the terminal: an Ink (React) TUI plus a
one-shot plain mode, talking to Anthropic, OpenAI, ChatGPT sign-in, Gemini and OpenAI-compatible servers through
their official SDKs. README.md is the user documentation and holds the full module map under "Layout".

## Commands

```sh
npm install
npm start               # run src/cli.tsx via tsx (pass args after --: npm start -- -m openai:gpt-5)
npm test                # node:test over test/*.test.ts and test/*.test.mjs
npm run typecheck       # tsc, covers src/, test/ and bench/
npm run build           # compile src/ to dist/ (what gets published)
npm run bench           # harness benchmark, see bench/README.md
```

Before calling a change done, run `npm run typecheck` and `npm test` and report the results. Node ≥ 22.14; there is
no linter or formatter, so match the surrounding code by hand.

## Architecture

Ports and adapters, with one dependency rule:

- `src/core/` is the domain and use cases: the agent loop, the provider-neutral conversation model, the `Provider`
  and `ToolSource` ports, settings, prompts. It imports nothing outside `core/`: no SDKs, no `node:fs`, no I/O, no UI.
- `src/adapters/` implements core's ports: providers, built-in tools, MCP, auth, storage, git worktrees, project
  context, skills.
- `src/ui/` sits on top: Ink components, hooks, slash commands, plain output.
- `src/composition.ts` is the only place that wires adapters into the core. `src/lib/` holds tiny generic helpers.

Rules that follow from it:

- Core takes its dependencies as arguments (see `AgentDeps`) so it can be tested with fakes.
- Conversation history uses the neutral format in `core/conversation.ts`. Each assistant turn also keeps the
  provider's native content and replays it verbatim to the same provider (thinking blocks, thought signatures);
  don't drop or rewrite it.
- Tools return structured results. Display-only data (e.g. `ExecutionResult.change`, the `FileChange` behind a diff)
  never reaches the model; only the UI turns it into colors.
- Keep logic out of React components. Flows and state machines live in plain `.ts` modules that are unit tested
  (`ui/session.ts`, `ui/loginFlow.ts`, `ui/mcpWizard.ts`, `ui/diff.ts`); components and hooks just bind them.
- Never block the event loop: use async `fs/promises` and `execFile`, not the `*Sync` variants, in anything the TUI
  can reach (a slow git once froze the UI).
- Everything megacode saves goes through `adapters/storage.ts` under the config folder (`~/.megacode` or
  `$MEGACODE_CONFIG_DIR`). Don't hard-code `~/.megacode`. Credentials are written only by `adapters/auth/store.ts`
  and `adapters/accounts.ts`, with mode 600.

Extension points:

- Provider: implement `Provider` (`core/provider.ts`) in `src/adapters/providers/`, add it to `catalog.ts`, construct
  it in `registry.ts`. Prefer catalog data (`keyOptional`, `usesEndpoint`, …) over provider-name special cases.
  Shared helpers (tool-argument parsing, call ids, data URLs, effort) live in `providers/shared.ts`.
- Built-in tool: a `Tool` object (name, description, JSON-schema `parameters`, `run`) registered in
  `adapters/tools/index.ts`. Arguments are validated against the schema before `run`. Side effects go through
  `ctx.approve`; respect `ctx.signal`. Large output goes through the budgets in `tools/output.ts`.
- Tool source: implement `ToolSource` (`core/tools.ts`) and combine it in `composition.ts` with `combineToolSources`.
- Slash command: add it to the registry in `ui/commands.ts`; new dialogs use the shared `Dialog` frame.

## Code style

TypeScript, ESM, strict mode, run directly by tsx and compiled by `tsc`.

- Imports use the real file extension: `./agent.ts`, `./Dialog.tsx` (`tsconfig.build.json` rewrites them on build).
- `verbatimModuleSyntax`: type-only imports use `import type { … }` or inline `type` (`import { Agent, type AgentDeps }`).
- `erasableSyntaxOnly`: no `enum`, `namespace` or constructor parameter properties. Use `as const` arrays with a
  derived union (`EFFORTS` / `Effort`) instead of enums.
- Node built-ins with the `node:` prefix (`node:fs/promises`, `node:path`, `node:test`).
- Formatting: 2-space indent, double quotes, semicolons, trailing commas in multi-line literals. Lines run long
  (up to ~140 characters); don't wrap something that reads fine on one line.
- `type` aliases for data shapes; `interface` for ports that classes implement (`Provider`, `ToolSource`).
  Classes only where there is real state (providers, `Agent`, `AgentSession`, `McpManager`); otherwise plain
  functions and object literals.
- No `any`. Narrow `unknown`, type errors as e.g. `NodeJS.ErrnoException` when checking `code`.
- Names: `camelCase` functions and values, `PascalCase` types, classes and components, `UPPER_SNAKE` module
  constants. Components get one file each, named after the component (`ModelPicker.tsx`); other modules are
  `camelCase.ts`. Named exports only, no default exports.
- Small, focused modules and functions; arrow functions for one-liners, `function` declarations otherwise. Early
  returns over nested conditionals; no nested ternaries.
- Comments: a short `/** … */` on exported and non-obvious functions saying what it is or returns, in plain
  sentences ("File contents, or null if it doesn't exist."). Inline comments explain why, not what. Don't
  narrate the code.
- Errors: throw `Error` with a message a user can act on ("File changed while awaiting approval. Read it again
  before retrying the edit."). Tool failures become `{ isError: true }` results the model can see, not crashes.
- Dependencies: keep them few. Check the existing ones (chalk, diff, yaml, the SDKs) before adding a package.

## UI conventions

- Every dialog uses `ui/Dialog.tsx`: title · subtitle, body, dim key-hint footer ("… · esc cancel").
- Layouts must hold at narrow widths: check roughly 40–120 columns. Truncate or wrap under the column; never
  push the permission mode off the status line.
- Wording is short and lowercase in hints, sentence case in messages; pluralize correctly ("1 line", "3 lines");
  show paths with `~` via the existing helpers.
- Keyboard behavior should match the existing shortcuts table in README.md (esc interrupts or goes back one step,
  ctrl+c twice exits).

## Tests

- `node:test` with `node:assert/strict`, in `test/`, one file per area (`agent.test.ts`, `session.test.ts`, …).
  Import sources from `../src/…` with the `.ts` extension.
- Use small hand-written fakes (a scripted `Provider`, an in-memory `ToolSource`, a `SessionHost` recorder), not
  mocking libraries.
- Point the config folder at a temporary directory in tests; never touch the real `~/.megacode` or `HOME`.
- `test/e2e.test.mjs` runs the real CLI against `test/fixtures/fake-openai.mjs` in a fresh workspace; MCP tests use
  `test/fixtures/mcp-echo-server.mjs`. Add an end-to-end case when a bug crosses the CLI/provider boundary.
- A bug fix comes with a regression test, and that test must fail without the fix. Check it.
- Tests must pass both piped and in a color terminal (`FORCE_COLOR=3`): compare rendered text with escape codes
  stripped (`stripVTControlCharacters`).
- Test names describe behavior in plain words: `"esc goes back one step, or closes when there is nothing before"`.

## Verifying changes

Tests are not the whole check. For anything user-visible, run it: `npm start` (in a pty for TUI changes) or the
one-shot mode, against a real provider if credentials exist or the fake server otherwise. If something could not be
verified (e.g. no credentials for a provider), say so explicitly.

## Docs

- README.md documents every user-facing feature, flag, setting, key and command. Update it in the same change.
- When adding, moving or removing a module, update the "Layout" tree in README.md.
- Keep AGENTS.md accurate when conventions change.

## Commits and releases

- Branch off `main`; work in a worktree when running in parallel with other agents.
- Commit subject: imperative, capitalized, no trailing period, ~70 characters ("Make git calls async; pull login
  and MCP wizard flows out of the UI").
- Body for anything non-trivial: what changed and why, grouped under short headings or bullets per area; call out
  each fixed bug ("Fix: …") with how it was reproduced; say what was and wasn't verified; end with the result,
  e.g. "141 tests pass; typecheck clean."
- Releases are a separate commit, "Release vX.Y.Z", bumping `package.json` and `package-lock.json`.
  `prepublishOnly` runs tests, typecheck and build before `npm publish`.
- Never commit `dist/`, `.megacode/`, `.bench/`, `.env` files or credentials.
