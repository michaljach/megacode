import os from "node:os";
import { styleText } from "node:util";
import chalk from "chalk";
import type { ToolCall } from "../../core/conversation.ts";
import type { ApprovalRequest, FileChange } from "../../core/tools.ts";
import { plural } from "../../lib/plural.ts";
import { buildDiff, diffToAnsi, type DiffModel } from "./diff.ts";

const TOOL_LABELS: Record<string, string> = {
  ask_questions: "Ask",
  view_image: "View",
  read_file: "Read",
  write_file: "Write",
  edit_file: "Update",
  bash: "Bash",
  list_files: "List",
  grep: "Search",
};

/** A tool call's name and its main argument: "Bash" + "npm test", "Read" + "src/cli.ts". */
export function callParts(c: ToolCall): { name: string; arg: string } {
  const mcp = c.name.match(/^mcp__(.+?)__(.+)$/);
  const firstString = Object.values(c.input ?? {}).find((v) => typeof v === "string");
  const arg = String((mcp ? firstString : (c.input.command ?? c.input.path ?? c.input.pattern)) ?? "").split("\n")[0]!;
  return { name: mcp ? `${mcp[1]} · ${mcp[2]} (MCP)` : (TOOL_LABELS[c.name] ?? c.name), arg: arg.length > 80 ? arg.slice(0, 80) + "…" : arg };
}

/** The text shown for an approval request in plain output: a diff for file changes, else the tool's own description. */
export function approvalBody(req: ApprovalRequest): string {
  if (!req.change) return req.body ?? "";
  const model = buildDiff(req.change);
  return model ? diffToAnsi(model) : "Diff preview unavailable (file too large).";
}

/** Shortens paths under the home directory to ~/… for display. */
export const tildify = (p: string) => p.replace(os.homedir(), "~");

/** A token count as "950", "15.4k" or "128k". */
export const formatTokens = (n: number) => (n < 1000 ? String(n) : `${Number((n / 1000).toFixed(1))}k`);

/**
 * The model spec shown in the status line and banner. Local servers (LM Studio, Ollama) report
 * gguf file paths as model ids; reduce an absolute file path to its file name so the path stays
 * off the row. Cloud ids, ollama tags (qwen3:8b), and OpenRouter's provider/model slugs
 * (anthropic/claude-3-5-sonnet) contain colons or slashes but are not file paths, so they are
 * left alone. The provider prefix is kept so the user can still retype the spec into /model.
 */
export function modelDisplay(spec: string): string {
  const i = spec.indexOf(":");
  if (i === -1) return spec;
  const model = spec.slice(i + 1);
  const isFilePath = model.startsWith("/") || /^[A-Za-z]:[\\/]/.test(model);
  if (!isFilePath) return spec;
  return `${spec.slice(0, i)}:${model.replace(/\\/g, "/").split("/").at(-1)}`;
}

/** Display-only prompt preview; queued/sent prompts and history retain the full text. */
export function previewPrompt(text: string): string {
  const chars = Array.from(text.replace(/\r\n|[\r\n]/g, " ⏎ ").replace(/\t/g, " "));
  return chars.length > 200 ? chars.slice(0, 199).join("") + "…" : chars.join("");
}

/** First few lines of tool output for the transcript. */
export function previewOutput(output: string, lines = 3): string {
  const all = output.trimEnd().split("\n");
  const head = all.slice(0, lines).join("\n");
  return all.length > lines ? `${head}\n${styleText("dim", `… +${plural(all.length - lines, "line")}`)}` : head;
}

const count = (n: number, word: string) => plural(n, word).replace(/^\S+/, (number) => chalk.bold(number));

/** Claude Code's summary of an applied change: "Added 2 lines, removed 1 line", "Wrote 14 lines to a.ts". */
export function describeChange(change: FileChange, model: DiffModel | null = buildDiff(change, 0)): string {
  if (!model) return "Changed (too large to compare)";
  if (model.created) return `Wrote ${count(model.added, "line")} to ${chalk.bold(model.file)}`;
  const parts = [model.added && `added ${count(model.added, "line")}`, model.removed && `removed ${count(model.removed, "line")}`].filter(Boolean);
  const text = parts.join(", ");
  return text ? text[0]!.toUpperCase() + text.slice(1) : "No changes";
}

/** "Read 3 lines", or "Read 200 of 1,234 lines" for a partial read. */
function describeRead(output: string): string {
  if (output.startsWith("[EOF:")) return output;
  const shown = output.match(/^\d+\t/gm)?.length ?? 0;
  const total = output.match(/\[(\d+) lines total; continue/)?.[1];
  return total ? `Read ${shown.toLocaleString("en-US")} of ${plural(Number(total), "line")}` : `Read ${plural(shown, "line")}`;
}

/**
 * What the transcript shows for a finished tool call. The model gets the full output; people get
 * a summary where the raw text would only repeat what the diff or the call already says.
 */
export function displayOutput(call: ToolCall, result: { output: string; isError: boolean; change?: FileChange }, model?: DiffModel | null): string {
  if (result.isError) return result.output;
  if (result.change) return describeChange(result.change, model);
  if (call.name === "read_file") return describeRead(result.output);
  return result.output;
}
