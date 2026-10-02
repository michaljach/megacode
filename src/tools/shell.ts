import { spawn } from "node:child_process";
import { loadSettings } from "../config.ts";
import { compactOutput } from "./output.ts";
import type { ExecutionResult, Tool } from "./types.ts";

const MAX_CAPTURE = 10_000_000; // bound memory for runaway commands; the model sees a compacted view anyway

function run(cmd: string, args: string[], opts: { shell?: boolean; timeout?: number; signal?: AbortSignal; successCodes?: number[] } = {}): Promise<ExecutionResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: process.cwd(),
      shell: opts.shell,
      timeout: opts.timeout ?? 120_000,
      signal: opts.signal,
      stdio: ["ignore", "pipe", "pipe"], // never let a command grab the terminal
    });
    let out = "";
    let dropped = 0;
    const collect = (data: string) => {
      const room = Math.max(0, MAX_CAPTURE - out.length);
      out += data.slice(0, room);
      dropped += data.length - Math.min(data.length, room);
    };
    // Decode each stream incrementally so split UTF-8 characters are preserved.
    child.stdout.setEncoding("utf8").on("data", collect);
    child.stderr.setEncoding("utf8").on("data", collect);
    let finished = false;
    const finish = async (isError: boolean, ...notes: string[]) => {
      if (finished) return; // "error" and "close" can both fire
      finished = true;
      const text = (await compactOutput(out)).trimEnd();
      resolve({ output: [text, dropped ? `[${dropped} more chars not captured]` : "", ...notes].filter(Boolean).join("\n"), isError });
    };
    child.on("error", (e) => finish(true, e.name === "AbortError" ? "[interrupted]" : `Error: ${e.message}`));
    child.on("close", (code, signal) => {
      const success = !signal && code !== null && (opts.successCodes ?? [0]).includes(code);
      finish(!success, !success && code !== null ? `[exit code ${code}]` : "", signal ? `[killed: ${signal}]` : "");
    });
  });
}

export const bash: Tool = {
  name: "bash",
  description: "Run a shell command in the working directory. Returns combined stdout/stderr.",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string" },
      timeout_ms: { type: "number", description: "Timeout in milliseconds (default set by the user, usually 120000)" },
    },
    required: ["command"],
  },
  async run({ command, timeout_ms }, { approve, signal }) {
    if (!(await approve({ tool: "bash", title: "Bash command", body: command }))) return "User denied the command.";
    const result = await run(command, [], { shell: true, timeout: timeout_ms ?? loadSettings().bashTimeoutMs, signal });
    return { ...result, output: result.output || "(no output)" };
  },
};

export const grep: Tool = {
  name: "grep",
  description: "Search file contents with a regular expression. Returns matching lines with file:line prefixes.",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string" },
      path: { type: "string", description: "Directory or file to search, default '.'" },
    },
    required: ["pattern"],
  },
  async run({ pattern, path: p = "." }, { signal }) {
    const result = await run("grep", ["-rnIE", "--exclude-dir=node_modules", "--exclude-dir=.git", "--", pattern, p], { signal, successCodes: [0, 1] });
    return { ...result, output: result.output || "No matches." };
  },
};
