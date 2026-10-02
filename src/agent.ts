import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import { loadSettings } from "./config.ts";
import { mcp } from "./mcp.ts";
import { resolve } from "./providers/index.ts";
import { executeTool, toolSpecs, type Approve } from "./tools.ts";
import type { Message, ToolCall, ToolResult } from "./types.ts";

export type AgentEvents = {
  approve: Approve;
  onText(delta: string): void;
  /** One model response finished (it may be followed by tool calls). */
  onStepEnd(): void;
  onToolStart(call: ToolCall): void;
  onToolEnd(call: ToolCall, result: { output: string; isError: boolean }): void;
  onNotice(text: string, level: "info" | "warn" | "error"): void;
};

function systemPrompt(): string {
  const parts = [
    "You are a coding agent running in the user's terminal. Use the tools to inspect and change the project.",
    "Read files before editing them. Prefer edit_file for targeted changes. Keep answers concise; the terminal renders Markdown.",
    `Working directory: ${process.cwd()}\nPlatform: ${os.platform()} ${os.release()}`,
  ];
  if (loadSettings().projectInstructions)
    for (const f of ["AGENTS.md", "CLAUDE.md"])
      if (existsSync(f)) parts.push(`Project instructions from ${f}:\n${readFileSync(f, "utf8")}`);
  return parts.join("\n\n");
}

export class Agent {
  messages: Message[] = [];
  model: string;
  system = systemPrompt();
  usage = { input: 0, output: 0 };

  constructor(model: string) {
    resolve(model); // validate early
    this.model = model;
  }

  /** Rebuild the system prompt, e.g. after the project-instructions setting changes. */
  reloadSystemPrompt() {
    this.system = systemPrompt();
  }

  setModel(spec: string) {
    resolve(spec);
    this.model = spec;
  }

  async send(text: string, signal: AbortSignal, ev: AgentEvents): Promise<void> {
    this.messages.push({ role: "user", text });
    const { provider, model } = resolve(this.model);
    const maxSteps = loadSettings().maxSteps;

    try {
      for (let step = 0; step < maxSteps; step++) {
        const res = await provider.turn({
          model,
          system: [this.system, mcp.instructions()].filter(Boolean).join("\n\n"),
          messages: this.messages,
          tools: [...toolSpecs, ...mcp.toolSpecs()],
          signal,
          onText: ev.onText,
        });
        if (res.usage) {
          this.usage.input += res.usage.input;
          this.usage.output += res.usage.output;
        }
        this.messages.push(res.message);
        ev.onStepEnd();

        if (res.stop === "refusal") return ev.onNotice("The model declined to respond.", "warn");
        if (res.stop === "max_tokens") {
          // A truncated tool call may have incomplete arguments; don't run it.
          if (res.message.toolCalls.length) this.pushInterrupted(res.message.toolCalls, "Output was truncated (max tokens); tool not run.");
          return ev.onNotice("Output truncated: max tokens reached.", "warn");
        }
        if (!res.message.toolCalls.length) return;

        const results: ToolResult[] = [];
        for (const call of res.message.toolCalls) {
          if (signal.aborted) break;
          ev.onToolStart(call);
          const r = mcp.has(call.name) ? await mcp.execute(call, ev.approve, signal) : await executeTool(call, ev.approve, signal);
          ev.onToolEnd(call, r);
          results.push({ id: call.id, name: call.name, ...r });
        }
        this.messages.push({ role: "tool", results });
        if (signal.aborted) throw signal.reason;
      }
      ev.onNotice(`Stopped after ${maxSteps} steps (raise the limit in /config).`, "warn");
    } finally {
      this.repairHistory();
    }
  }

  /** Every tool call needs a result before the next user message; fill in any the loop didn't reach. */
  private repairHistory() {
    const last = this.messages.at(-1);
    if (last?.role === "tool") {
      const prev = this.messages.at(-2);
      if (prev?.role === "assistant") {
        const done = new Set(last.results.map((r) => r.id));
        for (const c of prev.toolCalls)
          if (!done.has(c.id)) last.results.push({ id: c.id, name: c.name, output: "Interrupted by user.", isError: true });
      }
    } else if (last?.role === "assistant" && last.toolCalls.length) {
      this.pushInterrupted(last.toolCalls, "Interrupted by user.");
    }
  }

  private pushInterrupted(calls: ToolCall[], output: string) {
    this.messages.push({ role: "tool", results: calls.map((c) => ({ id: c.id, name: c.name, output, isError: true })) });
  }

  clear() {
    this.messages = [];
    this.usage = { input: 0, output: 0 };
  }
}
