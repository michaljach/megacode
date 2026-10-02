import { spawn } from "node:child_process";
import { glob, mkdir, mkdtemp, open, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { filePage, previewOutput } from "./output.ts";
import path from "node:path";
import { renderFileChange } from "./code.ts";
import { loadSettings } from "./config.ts";
import type { ImageContent, ToolCall, ToolSpec } from "./types.ts";

/** Ask the user before a side effect. `body` may contain ANSI colors (e.g. a diff). */
export type Approve = (req: { tool: string; title: string; body: string }) => Promise<boolean>;
type Ctx = { approve: Approve; signal?: AbortSignal };

const IGNORE = ["**/node_modules/**", "**/.git/**"];
const MAX_CAPTURE = 10_000_000; // bound memory for runaway commands; the model sees a compacted view anyway

export type ExecutionResult = { output: string; isError: boolean; images?: ImageContent[]; changePreview?: string };
type Tool = ToolSpec & { run: (input: any, ctx: Ctx) => Promise<string | ExecutionResult> };

const resolvePath = (p: string) => path.resolve(process.cwd(), p);

/**
 * Fits output into the "Max tool output" budget (see /config), keeping both ends. The full text goes to a
 * temporary file the model can read, so nothing is lost without filling every later request.
 */
export async function compactOutput(text: string, budget = loadSettings().maxToolOutput): Promise<string> {
  if (text.length <= budget) return text;
  try {
    const dir = await mkdtemp(path.join(tmpdir(), "megacode-output-"));
    const file = path.join(dir, "output.txt");
    await writeFile(file, text, { mode: 0o600 });
    return `${previewOutput(text, budget)}\n[Full output: ${file}; read_file or search this file]`;
  } catch {
    // Do not silently discard evidence if the temporary directory is unavailable.
    return text;
  }
}

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

const tools: Tool[] = [
  {
    name: "view_image",
    description: "View a local PNG, JPEG, GIF, or WebP image (up to 5 MiB). Use for screenshots and other visual files; requires a vision-capable model.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Relative or absolute image path" } },
      required: ["path"],
    },
    async run({ path: p }) {
      const file = await open(resolvePath(p), "r");
      try {
        const max = 5 * 1024 * 1024;
        const info = await file.stat();
        if (!info.isFile()) throw new Error("Image path must be a regular file.");
        if (info.size > max) throw new Error("Image exceeds 5 MiB; resize it before viewing.");
        const buffer = Buffer.alloc(max + 1);
        let size = 0;
        while (size < buffer.length) {
          const { bytesRead } = await file.read(buffer, size, buffer.length - size, null);
          if (!bytesRead) break;
          size += bytesRead;
        }
        if (size > max) throw new Error("Image exceeds 5 MiB; resize it before viewing.");
        const data = buffer.subarray(0, size);
        let mediaType: ImageContent["mediaType"];
        if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) mediaType = "image/png";
        else if (data[0] === 255 && data[1] === 216 && data[2] === 255) mediaType = "image/jpeg";
        else if (["GIF87a", "GIF89a"].includes(data.toString("ascii", 0, 6))) mediaType = "image/gif";
        else if (data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP") mediaType = "image/webp";
        else throw new Error("Unsupported image format. Use PNG, JPEG, GIF, or WebP.");
        return { output: `Image: ${resolvePath(p)} (${mediaType}, ${size} bytes)`, isError: false, images: [{ mediaType, data: data.toString("base64") }] };
      } finally {
        await file.close();
      }
    },
  },
  {
    name: "read_file",
    description: "Read numbered text lines. Large results include a continuation offset.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative or absolute path" },
        offset: { type: "number", description: "1-based line to start from" },
        limit: { type: "number", description: "Max lines (default 200); also bounded by character budget" },
      },
      required: ["path"],
    },
    async run({ path: p, offset, limit }) {
      return filePage(await readFile(resolvePath(p), "utf8"), offset, limit);
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
      const readExisting = () => readFile(abs, "utf8").catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      const before = await readExisting();
      const changePreview = renderFileChange(abs, before ?? "", content);
      if (!(await approve({ tool: "write_file", title: `Write ${path.relative(process.cwd(), abs)}`, body: changePreview })))
        return "User denied the write.";
      if (await readExisting() !== before)
        throw new Error("File changed while awaiting approval. Read it again before retrying the write.");
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, content);
      return { output: `Wrote ${abs}`, isError: false, changePreview };
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
      const updated = replace_all ? text.replaceAll(old_string, () => new_string) : text.replace(old_string, () => new_string);
      const changePreview = renderFileChange(abs, text, updated);
      if (!(await approve({ tool: "edit_file", title: `Edit ${path.relative(process.cwd(), abs)}`, body: changePreview })))
        return "User denied the edit.";
      if (await readFile(abs, "utf8") !== text)
        throw new Error("File changed while awaiting approval. Read it again before retrying the edit.");
      await writeFile(abs, updated);
      return { output: `Edited ${abs} (${replace_all ? count : 1} replacement${count > 1 && replace_all ? "s" : ""})`, isError: false, changePreview };
    },
  },
  {
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
      let more = false;
      for await (const f of glob(pattern, { cwd: process.cwd(), exclude: IGNORE })) {
        if (files.length >= 1000) { more = true; break; }
        files.push(f);
      }
      const output = files.length ? await compactOutput(files.sort().join("\n")) : "No files found.";
      return output + (more ? "\n[Only 1000 entries listed; narrow the glob pattern]" : "");
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
      const result = await run("grep", ["-rnIE", "--exclude-dir=node_modules", "--exclude-dir=.git", "--", pattern, p], { signal, successCodes: [0, 1] });
      return { ...result, output: result.output || "No matches." };
    },
  },
];

export const toolSpecs: ToolSpec[] = tools.map(({ name, description, parameters }) => ({ name, description, parameters }));

export async function executeTool(
  call: ToolCall,
  approve: Approve,
  signal?: AbortSignal,
): Promise<ExecutionResult> {
  const tool = tools.find((t) => t.name === call.name);
  if (!tool) return { output: `Unknown tool: ${call.name}`, isError: true };
  try {
    const input: unknown = call.input;
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new Error("Tool arguments must be a JSON object.");
    if ("_invalid_json" in input) throw new Error("Tool arguments were not valid JSON.");
    const missing = (tool.parameters.required ?? []).filter((k) => !Object.hasOwn(input, k) || call.input[k] === undefined);
    if (missing.length) throw new Error(`Missing required arguments: ${missing.join(", ")}`);
    for (const [key, schema] of Object.entries(tool.parameters.properties)) {
      const value = call.input[key];
      if (value === undefined) continue;
      const { type } = schema as { type: string };
      if (typeof value !== type) throw new Error(`${key} must be a ${type}.`);
      if (type === "number" && (!Number.isSafeInteger(value) || (value as number) < (key === "timeout_ms" ? 0 : 1)))
        throw new Error(`${key} must be a ${key === "timeout_ms" ? "non-negative" : "positive"} safe integer.`);
    }
    if (call.name === "edit_file" && call.input.old_string === "") throw new Error("old_string must not be empty.");
    signal?.throwIfAborted();
    const result = await tool.run(call.input, { approve, signal });
    return typeof result === "string" ? { output: result, isError: false } : result;
  } catch (e) {
    return { output: `Error: ${(e as Error).message}`, isError: true };
  }
}
