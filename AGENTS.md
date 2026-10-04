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
  (`ui/session.ts`, `ui/shortcuts.ts`, `ui/dialogs/login/loginFlow.ts`, `ui/dialogs/model/modelRows.ts`,
  `ui/prompt/editing.ts`, `ui/text/diff.ts`);
  components and hooks just bind them.
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
- Slash command: add it to the registry in `ui/commands.ts`; a new dialog goes in `ui/dialogs/`, uses the shared
  `Dialog` frame, and gets a case in `ActiveDialog`.

## Code style

The bar: small, direct, modern code that a careful senior engineer would be happy to maintain. Every line earns
its place; nothing is there for show.

### Design

- Composition over inheritance. Build behavior from functions and small objects passed in: ports, `AgentDeps`,
  `combineToolSources`, the command registry. No class hierarchies; `extends` only for `Error` subclasses.
- Dependencies come in as arguments. Only `composition.ts` and the entry point pick concrete adapters; other
  modules don't reach for globals or singletons they could be given.
- Pure logic, side effects at the edges. Compute data in plain functions, then do I/O or rendering with the
  result. Pure code is tested directly, without fakes.
- DRY, with judgment. When logic shows up a second time, extract it into the module that owns the concept
  (`providers/shared.ts`, `tools/output.ts`, `ui/text/format.ts`, `ui/components/Dialog.tsx`). Search for an existing helper
  before writing one. Don't abstract a single use, and don't merge code that only looks alike.
- Data over branches: tables and catalogs (`catalog.ts`, `DIFF_COLORS`, the command registry) instead of
  `if (name === "…")` chains and per-case special handling.
- Make illegal states unrepresentable: discriminated unions (`DiffRow`), `as const` unions, required fields
  instead of optional fields plus runtime checks.

### Files and folders

- One concept per file, and the file name says which. Aim for under ~200 lines; past ~300, split by
  responsibility (logic into a `.ts` module, pieces into their own components).
- Folders follow the layers first (`core/`, `adapters/`, `ui/`), then the area (`adapters/providers/`,
  `adapters/tools/`, `ui/dialogs/mcp/`). Give an area a folder once it has several files; a lone file stays flat.
  In `ui/`: shared building blocks in `components/`, then one folder per screen area (`transcript/`, `prompt/`,
  `dialogs/`, with a subfolder per multi-screen dialog), `hooks/` for app-level hooks, and `text/` for rendering
  shared with plain output. A dialog's own hook or rules live next to it (`dialogs/login/useLogin.ts`).
- No `utils.ts`, `helpers.ts` or `common/` dumping grounds. A helper lives with the concept it serves, or in
  `lib/` if it's truly generic (`withTimeout`).
- No barrel files that only re-export; import from the module that defines the thing.
- Inside a file: imports, then constants and types, then private helpers, then the exports built from them.

### Functions

- Small and single-purpose, named for what they return or do (`readIfExists`, `markChangedWords`,
  `describeChange`). If a function needs section comments, it's several functions.
- Early returns over nesting; no nested ternaries; no boolean parameters that switch between two behaviors
  (write two functions).
- More than about three parameters, or any optional ones: take an options object
  (`readProjectContext({ includeInstructions })`).
- `const` by default, `let` only when reassigned. Don't mutate arguments; return new values.

### TypeScript

ESM, strict mode, run directly by tsx and compiled by `tsc`.

- Imports use the real file extension: `./agent.ts`, `./Dialog.tsx` (`tsconfig.build.json` rewrites them on build).
- `verbatimModuleSyntax`: type-only imports use `import type { … }` or inline `type` (`import { Agent, type AgentDeps }`).
- `erasableSyntaxOnly`: no `enum`, `namespace` or constructor parameter properties. Use `as const` arrays with a
  derived union (`EFFORTS` / `Effort`) instead of enums.
- `type` aliases for data shapes; `interface` for ports that classes implement (`Provider`, `ToolSource`).
  Classes only where there is real state (providers, `Agent`, `AgentSession`, `McpManager`); otherwise plain
  functions and object literals. New class fields use `#private`, not the `private` keyword.
- No `any`, and no `as` casts to quiet the compiler outside tests: narrow `unknown`, and type errors as e.g.
  `NodeJS.ErrnoException` when checking `code`. Use `satisfies` to check a literal without widening it.
- Use the platform: `?.` and `??`, `flatMap`, `at(-1)`, `toSorted`, `Object.fromEntries`, `structuredClone`,
  `fs/promises` (including `glob`), `node:util` (`promisify`, `stripVTControlCharacters`). No packages for what
  Node already does.
- `async`/`await`, not `.then` chains. Run independent work with `Promise.all`. Anything long-running or
  user-interruptible takes an `AbortSignal` and passes it on.
- `for…of` over `.forEach`; array methods (`map`, `filter`, `some`) when they read better than a loop.

### Formatting and naming

- Node built-ins with the `node:` prefix (`node:fs/promises`, `node:path`, `node:test`).
- 2-space indent, double quotes, semicolons, trailing commas in multi-line literals. Lines run long (up to ~140
  characters); don't wrap something that reads fine on one line.
- `camelCase` functions and values, `PascalCase` types, classes and components, `UPPER_SNAKE` module constants.
  Components get one file each, named after the component (`ModelPicker.tsx`); other modules are `camelCase.ts`.
  Named exports only, no default exports.
- Arrow functions for one-liners, `function` declarations otherwise.
- Names are concrete and domain-specific. No `data`, `info`, `item2`, `handleStuff`, `doProcess`, `Manager` for
  things that don't manage anything.

### Comments and errors

- A short `/** … */` on exported and non-obvious functions saying what it is or returns, in plain sentences
  ("File contents, or null if it doesn't exist."). Inline comments explain why, not what.
- Throw `Error` with a message a user can act on ("File changed while awaiting approval. Read it again before
  retrying the edit."). Tool failures become `{ isError: true }` results the model can see, not crashes.
- Catch only where you can handle it (ENOENT → `null`, a rejected parameter → retry without it). Don't wrap
  code in `try`/`catch` just to log or rethrow.
- Dependencies: keep them few. Check the existing ones (chalk, diff, yaml, the SDKs) before adding a package.

### No slop

- No dead code, commented-out code, unused exports or parameters, or stray `console.log`.
- No speculative generality: no options, hooks, layers or config for needs that don't exist yet.
- No defensive noise: don't null-check what the types guarantee, and don't add fallbacks that hide bugs.
- No comments that restate the code, banner or divider comments, "helper function" labels, or history
  ("changed to fix X", "new:"). History belongs in the commit message.
- No emoji or decorative output in code, logs or UI text beyond the glyphs the UI already uses.
- Keep diffs focused: no drive-by reformatting, renames or refactors outside the change. If something nearby
  is wrong, mention it or fix it in its own commit.
- Leave code better than you found it, but only within what the change touches. When a file you're editing
  crosses the size or duplication lines above, split or extract as part of the change.

## UI conventions

- Every dialog uses `ui/components/Dialog.tsx`: title · subtitle, body, dim key-hint footer ("… · esc cancel").
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
- Tag each release `vX.Y.Z` and publish a GitHub release whose description is the changelog since the previous
  tag: user-facing changes grouped under "Added", "Changed", "Fixed" (and "Internal" for refactors, tests and
  docs), then a "Full Changelog" compare link. No release goes out with only the generated link.
- Never commit `dist/`, `.megacode/`, `.bench/`, `.env` files or credentials.
