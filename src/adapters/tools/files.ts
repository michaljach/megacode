import { glob, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FileChange, Tool, ToolContext } from "../../core/tools.ts";
import { plural } from "../../lib/plural.ts";
import { compactOutput, filePage } from "./output.ts";
import { displayPath, resolvePath } from "./paths.ts";

const IGNORE = ["**/node_modules/**", "**/.git/**"];
const MAX_LISTED = 1000;

/** File contents, or null if it doesn't exist. */
const readIfExists = (file: string) =>
  readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });

type Proposal = { tool: string; action: "write" | "edit"; file: string; before: string | null; after: string };

/**
 * Asks the user to approve the change, then writes it only if the file is still exactly what was
 * previewed, so edits made while the dialog was open are never overwritten. Null if denied.
 */
async function applyChange(ctx: ToolContext, p: Proposal): Promise<FileChange | null> {
  const change: FileChange = { file: p.file, before: p.before ?? "", after: p.after, ...(p.before === null ? { created: true } : {}) };
  const title = `${p.action === "write" ? "Write" : "Edit"} ${displayPath(p.file)}`;
  if (!(await ctx.approve({ tool: p.tool, title, change }))) return null;
  if ((await readIfExists(p.file)) !== p.before)
    throw new Error(`File changed while awaiting approval. Read it again before retrying the ${p.action}.`);
  await mkdir(path.dirname(p.file), { recursive: true });
  await writeFile(p.file, p.after);
  return change;
}

export const readFileTool: Tool<{ path: string; offset?: number; limit?: number }> = {
  name: "read_file",
  description: "Read numbered text lines. Large results include a continuation offset.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Relative or absolute path" },
      offset: { type: "integer", minimum: 1, description: "1-based line to start from" },
      limit: { type: "integer", minimum: 1, description: "Max lines (default 200); also bounded by character budget" },
    },
    required: ["path"],
  },
  async run({ path, offset, limit }) {
    return filePage(await readFile(resolvePath(path), "utf8"), offset, limit);
  },
};

export const writeFileTool: Tool<{ path: string; content: string }> = {
  name: "write_file",
  description: "Create or overwrite a file with the given content. Prefer edit_file for changes to existing files.",
  parameters: {
    type: "object",
    properties: { path: { type: "string" }, content: { type: "string" } },
    required: ["path", "content"],
  },
  async run({ path, content }, ctx) {
    const file = resolvePath(path);
    const before = await readIfExists(file);
    const change = await applyChange(ctx, { tool: "write_file", action: "write", file, before, after: content });
    if (!change) return "User denied the write.";
    return { output: `Wrote ${file}`, isError: false, change };
  },
};

export const editFile: Tool<{ path: string; old_string: string; new_string: string; replace_all?: boolean }> = {
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
  async run({ path, old_string, new_string, replace_all = false }, ctx) {
    if (old_string === "") throw new Error("old_string must not be empty.");
    const file = resolvePath(path);
    const before = await readFile(file, "utf8");
    const matches = before.split(old_string).length - 1;
    if (matches === 0) throw new Error("old_string not found in file");
    if (matches > 1 && !replace_all)
      throw new Error(`old_string matches ${matches} times; add context to make it unique or set replace_all`);
    // A replacer function keeps `$&` and friends in new_string literal.
    const after = replace_all ? before.replaceAll(old_string, () => new_string) : before.replace(old_string, () => new_string);
    const change = await applyChange(ctx, { tool: "edit_file", action: "edit", file, before, after });
    if (!change) return "User denied the edit.";
    return { output: `Edited ${file} (${plural(replace_all ? matches : 1, "replacement")})`, isError: false, change };
  },
};

export const listFiles: Tool<{ pattern?: string }> = {
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
      if (files.length > MAX_LISTED) break;
    }
    const truncated = files.splice(MAX_LISTED).length > 0;
    const output = files.length ? await compactOutput(files.sort().join("\n")) : "No files found.";
    return output + (truncated ? `\n[Only ${MAX_LISTED} entries listed; narrow the glob pattern]` : "");
  },
};
