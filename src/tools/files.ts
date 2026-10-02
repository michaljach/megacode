import { glob, mkdir, open, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderFileChange } from "../code.ts";
import type { ImageContent } from "../types.ts";
import { compactOutput, filePage } from "./output.ts";
import type { Tool } from "./types.ts";

const IGNORE = ["**/node_modules/**", "**/.git/**"];

const resolvePath = (p: string) => path.resolve(process.cwd(), p);

export const viewImage: Tool = {
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
};

export const readFileTool: Tool = {
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
};

export const writeFileTool: Tool = {
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
};

export const editFile: Tool = {
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
    if (old_string === "") throw new Error("old_string must not be empty.");
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
};

export const listFiles: Tool = {
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
};
