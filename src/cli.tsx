#!/usr/bin/env node
import { render } from "ink";
import { fstatSync } from "node:fs";
import { mcp } from "./adapters/mcp/manager.ts";
import { PROVIDERS } from "./adapters/providers/catalog.ts";
import { defaultModel } from "./adapters/providers/registry.ts";
import { loadSettings } from "./adapters/settings.ts";
import { runSkillsCommand } from "./adapters/skills.ts";
import { setConfigDir } from "./adapters/storage.ts";
import { parseCliArgs } from "./args.ts";
import { RemoteServer } from "./server/server.ts";
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
  -H <host>, -p <port>          serve the session to a remote front-end over WebSocket (ws://<host>:<port>)
                                (default 0.0.0.0:0, where port 0 picks a free one); a remote client
                                connects to watch the transcript and submit, interrupt and steer
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

async function runOnce(agent: Agent, prompt: string, mode: PermissionMode) {
  for (const failure of await mcp.start()) console.error(failure);
  const code = await runPlain(agent, prompt, mode);
  await mcp.closeAll();
  return code;
}

async function runInteractive(agent: Agent, mode: PermissionMode) {
  const app = render(<App agent={agent} initialMode={mode} />, { exitOnCtrlC: false, kittyKeyboard: { mode: "auto" } });
  await app.waitUntilExit();
  await mcp.closeAll();
  return 0;
}

/** Serves one session to remote front-ends (e.g. an iOS app) over WebSocket. The process
  stays alive until a signal; the handler stops the running turn and closes the sockets. */
function runServe(agent: Agent, mode: PermissionMode, host: string, port: number): void {
  (async () => {
    for (const failure of await mcp.start()) console.error(failure);
    const server = new RemoteServer(agent, mode);
    const actualPort = await server.listen(host, port).catch((e: Error) => fail(e.message));
    console.log(`front-ends can connect at ws://${host}:${actualPort}`);

    const shutdown = async () => {
      await mcp.closeAll().catch(() => {});
      await server.close().catch(() => {});
      process.exit(0);
    };
    for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => void shutdown());
  })();
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

const agent = orFail(() => createAgent(options.model ?? defaultModel()));
const mode = options.ask ? "ask" : loadSettings().permissionMode;
const prompt = await withPipedInput(options.prompt);

if (options.host !== undefined || options.port !== undefined) {
  const host = options.host ?? "0.0.0.0";
  const port = options.port ?? 0;
  if (prompt) fail("A prompt can't be run while the server is serving: drop it and connect a front-end instead.");
  runServe(agent, mode, host, port);
} else {
  const interactive = !prompt && process.stdin.isTTY && process.stdout.isTTY;
  if (!interactive && !prompt)
    fail("No prompt given. Run megacode in a terminal for the interactive UI, or pass a prompt.");
  process.exit(interactive ? await runInteractive(agent, mode) : await runOnce(agent, prompt, mode));
}
