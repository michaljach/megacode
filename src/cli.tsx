#!/usr/bin/env node
import { render } from "ink";
import { fstatSync } from "node:fs";
import { parseArgs } from "node:util";
import { Agent } from "./agent.ts";
import { runPlain } from "./plain.ts";
import { defaultModel, PROVIDERS } from "./providers/index.ts";
import { App } from "./ui/App.tsx";

const HELP = `megacode - minimal multi-provider coding agent

Usage:
  megacode [options]            interactive TUI
  megacode [options] "prompt"   run one prompt and exit (also used when stdin is piped)

Options:
  -m, --model <provider:model>  default: $MEGACODE_MODEL, else the last model you picked
  -y, --yolo                    run tools without asking for approval
  -h, --help

Providers: ${PROVIDERS.join(", ")}
Log in with /login inside the TUI, or set the provider's API key env var.`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    model: { type: "string", short: "m" },
    yolo: { type: "boolean", short: "y" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help) {
  console.log(HELP);
  process.exit(0);
}

let agent: Agent;
try {
  agent = new Agent(values.model ?? defaultModel());
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}

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
  process.exit(await runPlain(agent, prompt, !!values.yolo));
}

const app = render(<App agent={agent} initialMode={values.yolo ? "yolo" : "ask"} />, { exitOnCtrlC: false });
await app.waitUntilExit();
process.exit(0);
