#!/usr/bin/env node
import { render } from "ink";
import { fstatSync } from "node:fs";
import { describeChanges, openWorktree, removeWorktree, worktreeChanges, type Worktree } from "./adapters/git/worktree.ts";
import { mcp } from "./adapters/mcp/manager.ts";
import { PROVIDERS } from "./adapters/providers/catalog.ts";
import { defaultModel } from "./adapters/providers/registry.ts";
import { loadSettings } from "./adapters/settings.ts";
import { loadSession, newSessionId, saveSession } from "./adapters/sessions.ts";
import { runSkillsCommand } from "./adapters/skills.ts";
import { configDir, setConfigDir } from "./adapters/storage.ts";
import { parseCliArgs } from "./args.ts";
import { createAgent } from "./composition.ts";
import type { Agent } from "./core/agent.ts";
import type { PermissionMode } from "./core/settings.ts";
import { App } from "./ui/App.tsx";
import { runPlain } from "./ui/plain.ts";

const HELP = `megacode - minimal multi-provider coding agent

Usage:
  megacode [options]            interactive TUI
  megacode [options] "prompt"   run one prompt and exit (also used when stdin is piped)
  megacode skills list          list installed skills
  megacode skills install <local-directory|owner/repo|GitHub-URL> [--global]

Options:
  -m, --model <provider:model>  default: $MEGACODE_MODEL, else the last model you picked
  -a, --ask                     ask before writes, edits and shell commands (default: set in /config)
  -w, --worktree [name]         work in a git worktree at .megacode/worktrees/<name> on branch worktree-<name>
                                (created if needed; random name if omitted)
  -r, --resume <id>             continue a saved conversation (the id is printed when you quit)
  -h, --help

Providers: ${PROVIDERS.join(", ")}
Log in with /login inside the TUI, or set the provider's API key env var.`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** Runs `fn`, exiting with its error message instead of a stack trace. */
function orFail<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    fail((e as Error).message);
  }
}

/** Piped input (`cat log | megacode "explain"`) is appended to the prompt. */
async function withPipedInput(prompt: string): Promise<string> {
  const stdin = fstatSync(0);
  if (!stdin.isFIFO() && !stdin.isFile()) return prompt;
  let piped = "";
  for await (const chunk of process.stdin) piped += chunk;
  return [prompt, piped.trim()].filter(Boolean).join("\n\n");
}

/** What both run modes work with: the agent, the permission mode, the worktree (if any) and the session id. */
type Run = { agent: Agent; mode: PermissionMode; worktree: (Worktree & { created: boolean }) | null; home: string; sessionId: string };

async function runOnce({ agent, mode, worktree, home, sessionId }: Run, prompt: string) {
  for (const failure of await mcp.start()) console.error(failure);
  const code = await runPlain(agent, prompt, mode);
  await mcp.closeAll();
  // Saved like interactive sessions, so `megacode --resume <id> "…"` can continue it.
  await saveSession({ id: sessionId, cwd: process.cwd(), model: agent.model, messages: agent.messages }).catch(() => {});
  if (worktree) {
    // No one to ask: remove a worktree this run created and left untouched; keep anything else.
    const changes = await worktreeChanges(worktree);
    process.chdir(home);
    if (worktree.created && changes && !changes.files && !changes.commits) await removeWorktree(worktree);
    else console.error(`Worktree kept at ${worktree.path} (branch ${worktree.branch}, ${describeChanges(changes)}).`);
  }
  return code;
}

async function runInteractive({ agent, mode, worktree, home, sessionId }: Run) {
  let exitMessage = "";
  const app = render(
    <App
      agent={agent}
      initialMode={mode}
      initialWorktree={worktree}
      home={home}
      sessionId={sessionId}
      onExitMessage={(m) => (exitMessage = m)}
    />,
    // The kitty keyboard protocol (where the terminal supports it) tells ctrl+1…9 apart from plain digits.
  // Disabled: late protocol-query replies leak through as visible text.
    { exitOnCtrlC: false, kittyKeyboard: { mode: "disabled" } },
  );
  await app.waitUntilExit();
  await mcp.closeAll();
  if (exitMessage) console.log(exitMessage);
  return 0;
}

if (process.env.MEGACODE_CONFIG_DIR) setConfigDir(process.env.MEGACODE_CONFIG_DIR);

// Skill management doesn't require credentials, a model, MCP, or piped input.
if (process.argv[2] === "skills") {
  console.log(await runSkillsCommand(process.argv.slice(3)).catch((e: Error) => fail(e.message)));
  process.exit(0);
}

const options = orFail(() => parseCliArgs(process.argv.slice(2)));
if (options.help) {
  console.log(HELP);
  process.exit(0);
}

// Enter the worktree before creating the agent: its system prompt includes the working directory.
const home = process.cwd();
const worktree = options.worktree ? await openWorktree(options.worktree.name).catch((e: Error) => fail(e.message)) : null;
if (worktree) process.chdir(worktree.path);

const resumed = options.resume ? await loadSession(options.resume) : null;
if (options.resume && !resumed) fail(`No saved session ${options.resume} in ${configDir()}/sessions.`);
const agent = orFail(() => createAgent(options.model ?? resumed?.model ?? defaultModel()));
if (resumed) agent.restore(resumed.messages);
const mode = options.ask ? "ask" : loadSettings().permissionMode;
const run: Run = { agent, mode, worktree, home, sessionId: resumed?.id ?? newSessionId() };
const prompt = await withPipedInput(options.prompt);

const interactive = !prompt && process.stdin.isTTY && process.stdout.isTTY;
if (!interactive && !prompt) fail("No prompt given. Run megacode in a terminal for the interactive UI, or pass a prompt.");
process.exit(interactive ? await runInteractive(run) : await runOnce(run, prompt));
