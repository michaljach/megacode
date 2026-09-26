import { spawn } from "node:child_process";
import { glob, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { styleText } from "node:util";
import type { ToolCall, ToolSpec } from "./types.ts";

/** Ask the user before a side effect. `body` may contain ANSI colors (e.g. a diff). */
export type Approve = (req: { tool: string; title: string; body: string }) => Promise<boolean>;
type Ctx = { approve: Approve; signal?: AbortSignal };

const MAX_OUTPUT = 30_000;
const IGNORE = ["**/node_modules/**", "**/.git/**"];

type Tool = ToolSpec & { run: (input: any, ctx: Ctx) => Promise<string> };

const resolvePath = (p: string) => path.resolve(process.cwd(), p);

function truncate(s: string): string {
  return s.length > MAX_OUTPUT ? `${s.slice(0, MAX_OUTPUT)}\n... [truncated ${s.length - MAX_OUTPUT} chars]` : s;
}

function diff(oldStr: string, newStr: string): string {
  const minus = oldStr.split("\n").map((l) => styleText("red", `- ${l}`));
  const plus = newStr.split("\n").map((l) => styleText("green", `+ ${l}`));
  return [...minus, ...plus].join("\n");
}

function run(cmd: string, args: string[], opts: { shell?: boolean; timeout?: number; signal?: AbortSignal } = {}): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: process.cwd(),
      shell: opts.shell,
      timeout: opts.timeout ?? 120_000,
      signal: opts.signal,
      stdio: ["ignore", "pipe", "pipe"], // never let a command grab the terminal
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const done = (...notes: string[]) => resolve([truncate(out).trimEnd(), ...notes].filter(Boolean).join("\n"));
    child.on("error", (e) => (e.name === "AbortError" ? done("[interrupted]") : resolve(`Error: ${e.message}`)));
    child.on("close", (code, signal) => done(code ? `[exit code ${code}]` : "", signal ? `[killed: ${signal}]` : ""));
  });
}

const tools: Tool[] = [
  {
    name: "read_file",
    description: "Read a text file. Returns lines prefixed with line numbers. Use offset/limit for large files.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path, relative to the working directory or absolute" },
        offset: { type: "number", description: "1-based line to start from" },
        limit: { type: "number", description: "Max lines to return (default 2000)" },
      },
      required: ["path"],
    },
    async run({ path: p, offset = 1, limit = 2000 }) {
      const lines = (await readFile(resolvePath(p), "utf8")).split("\n");
      const slice = lines.slice(offset - 1, offset - 1 + limit);
      const body = slice.map((l, i) => `${String(offset + i).padStart(6)}\t${l}`).join("\n");
      const more = offset - 1 + limit < lines.length ? `\n... [${lines.length} lines total]` : "";
      return truncate(body + more);
    },
  },
  {
    name: "write_file",
    description: "Create or overwrite a file with the given content. Prefer edit_file for changes to existing files.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
    },
    async run({ path: p, content }, { approve }) {
      const abs = resolvePath(p);
      const preview = content.split("\n").slice(0, 20).map((l: string) => styleText("green", `+ ${l}`)).join("\n");
      if (!(await approve({ tool: "write_file", title: `Write ${path.relative(process.cwd(), abs)}`, body: preview })))
        return "User denied the write.";
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, content);
      return `Wrote ${abs}`;
    },
  },
  {
    name: "edit_file",
    description:
      "Replace an exact string in a file. old_string must match exactly (including whitespace) and be unique unless replace_all is true.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        old_string: { type: "string" },
        new_string: { type: "string" },
        replace_all: { type: "boolean" },
      },
      required: ["path", "old_string", "new_string"],
    },
    async run({ path: p, old_string, new_string, replace_all }, { approve }) {
      const abs = resolvePath(p);
      const text = await readFile(abs, "utf8");
      const count = text.split(old_string).length - 1;
      if (count === 0) throw new Error("old_string not found in file");
      if (count > 1 && !replace_all)
        throw new Error(`old_string matches ${count} times; add context to make it unique or set replace_all`);
      if (!(await approve({ tool: "edit_file", title: `Edit ${path.relative(process.cwd(), abs)}`, body: diff(old_string, new_string) })))
        return "User denied the edit.";
      await writeFile(abs, replace_all ? text.replaceAll(old_string, () => new_string) : text.replace(old_string, () => new_string));
      return `Edited ${abs} (${replace_all ? count : 1} replacement${count > 1 && replace_all ? "s" : ""})`;
    },
  },
  {
    name: "bash",
    description: "Run a shell command in the working directory. Returns combined stdout/stderr.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string" },
        timeout_ms: { type: "number", description: "Default 120000" },
      },
      required: ["command"],
    },
    async run({ command, timeout_ms }, { approve, signal }) {
      if (!(await approve({ tool: "bash", title: "Bash command", body: command }))) return "User denied the command.";
      return (await run(command, [], { shell: true, timeout: timeout_ms, signal })) || "(no output)";
    },
  },
  {
    name: "list_files",
    description: "List files matching a glob pattern (e.g. 'src/**/*.ts'). Ignores node_modules and .git.",
    parameters: {
      type: "object",
      properties: { pattern: { type: "string", description: "Glob pattern, default '**/*'" } },
    },
    async run({ pattern = "**/*" }) {
      const files: string[] = [];
      for await (const f of glob(pattern, { cwd: process.cwd(), exclude: IGNORE })) {
        files.push(f);
        if (files.length >= 1000) break;
      }
      return files.length ? truncate(files.sort().join("\n")) : "No files found.";
    },
  },
  {
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
      const out = await run("grep", ["-rnIE", "--exclude-dir=node_modules", "--exclude-dir=.git", "--", pattern, p], { signal });
      return out.trim() === "[exit code 1]" ? "No matches." : out;
    },
  },
];

export const toolSpecs: ToolSpec[] = tools.map(({ name, description, parameters }) => ({ name, description, parameters }));

export async function executeTool(
  call: ToolCall,
  approve: Approve,
  signal?: AbortSignal,
): Promise<{ output: string; isError: boolean }> {
  const tool = tools.find((t) => t.name === call.name);
  if (!tool) return { output: `Unknown tool: ${call.name}`, isError: true };
  if ("_invalid_json" in call.input) return { output: "Tool arguments were not valid JSON.", isError: true };
  const missing = (tool.parameters.required ?? []).filter((k) => call.input[k] === undefined);
  if (missing.length) return { output: `Missing required arguments: ${missing.join(", ")}`, isError: true };
  try {
    return { output: await tool.run(call.input, { approve, signal }), isError: false };
  } catch (e) {
    return { output: `Error: ${(e as Error).message}`, isError: true };
  }
}
