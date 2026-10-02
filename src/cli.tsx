#!/usr/bin/env node
import { render } from "ink";
import { fstatSync } from "node:fs";
import { parseArgs } from "node:util";
import { Agent } from "./agent.ts";
import { loadSettings } from "./config.ts";
import { mcp } from "./mcp.ts";
import { runPlain } from "./plain.ts";
import { defaultModel, PROVIDERS } from "./providers/index.ts";
import { App } from "./ui/App.tsx";
import { describeChanges, openWorktree, removeWorktree, WORKTREE_NAME, worktreeChanges } from "./worktree.ts";

const HELP = `megacode - minimal multi-provider coding agent

Usage:
  megacode [options]            interactive TUI
  megacode [options] "prompt"   run one prompt and exit (also used when stdin is piped)

Options:
  -m, --model <provider:model>  default: $MEGACODE_MODEL, else the last model you picked
  -a, --ask                     ask before writes, edits and shell commands (default: set in /config)
  -w, --worktree [name]         work in a git worktree at .megacode/worktrees/<name> on branch worktree-<name>
                                (created if needed; random name if omitted)
  -h, --help

Providers: ${PROVIDERS.join(", ")}
Log in with /login inside the TUI, or set the provider's API key env var.`;

// -w takes an optional name (`megacode -w`, `megacode -w fix-auth "prompt"`), which parseArgs can't express.
// The next argument is the name if it looks like one; otherwise it's left for the prompt.
const args = process.argv.slice(2);
let worktreeName: string | undefined;
let useWorktree = false;
const wi = args.findIndex((a) => a === "-w" || a === "--worktree" || a.startsWith("--worktree="));
if (wi !== -1) {
  useWorktree = true;
  const [flag] = args.splice(wi, 1);
  if (flag!.startsWith("--worktree=")) worktreeName = flag!.slice("--worktree=".length) || undefined;
  else if (args[wi] !== undefined && WORKTREE_NAME.test(args[wi]!)) worktreeName = args.splice(wi, 1)[0];
}

const { values, positionals } = parseArgs({
  args,
  allowPositionals: true,
  options: {
    model: { type: "string", short: "m" },
    ask: { type: "boolean", short: "a" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help) {
  console.log(HELP);
  process.exit(0);
}

// Enter the worktree before creating the agent: its system prompt includes the working directory.
const home = process.cwd();
let worktree: ReturnType<typeof openWorktree> | null = null;
if (useWorktree) {
  try {
    worktree = openWorktree(worktreeName);
    process.chdir(worktree.path);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}

let agent: Agent;
try {
  agent = new Agent(values.model ?? defaultModel());
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}

const mode = values.ask ? "ask" : loadSettings().permissionMode;

let prompt = positionals.join(" ");
const stdin = fstatSync(0);
if (stdin.isFIFO() || stdin.isFile()) {
  // Piped input (`cat log | megacode "explain"`) is appended to the prompt.
  let piped = "";
  for await (const chunk of process.stdin) piped += chunk;
  prompt = [prompt, piped.trim()].filter(Boolean).join("\n\n");
}

if (prompt || !process.stdin.isTTY || !process.stdout.isTTY) {
  if (!prompt) {
    console.error("No prompt given. Run megacode in a terminal for the interactive UI, or pass a prompt.");
    process.exit(1);
  }
  await mcp.start();
  for (const s of mcp.servers())
    if (s.status.state === "failed") console.error(`MCP server ${s.name} failed to connect: ${s.status.error}`);
  const code = await runPlain(agent, prompt, mode);
  await mcp.closeAll();
  if (worktree) {
    // No one to ask: remove a worktree this run created and left untouched; keep anything else.
    const changes = worktreeChanges(worktree);
    process.chdir(home);
    if (worktree.created && changes && !changes.files && !changes.commits) removeWorktree(worktree);
    else console.error(`Worktree kept at ${worktree.path} (branch ${worktree.branch}, ${describeChanges(changes)}).`);
  }
  process.exit(code);
}

let exitMessage = "";
const app = render(
  <App agent={agent} initialMode={mode} initialWorktree={worktree} home={home} onExitMessage={(m) => (exitMessage = m)} />,
  { exitOnCtrlC: false },
);
await app.waitUntilExit();
await mcp.closeAll();
if (exitMessage) console.log(exitMessage);
process.exit(0);
