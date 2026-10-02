import { styleText } from "node:util";
import { highlightCode } from "../code.ts";
import type { ToolCall } from "../types.ts";

const TOOL_LABELS: Record<string, string> = {
  read_file: "Read",
  write_file: "Write",
  edit_file: "Update",
  bash: "Bash",
  list_files: "List",
  grep: "Search",
};

/** "Bash(npm test)", "Read(src/cli.ts)" */
export function formatCall(c: ToolCall): string {
  const mcp = c.name.match(/^mcp__(.+?)__(.+)$/);
  const firstString = Object.values(c.input ?? {}).find((v) => typeof v === "string");
  const arg = String((mcp ? firstString : (c.input.command ?? c.input.path ?? c.input.pattern)) ?? "").split("\n")[0]!;
  const label = mcp ? `${mcp[1]} · ${mcp[2]} (MCP)` : (TOOL_LABELS[c.name] ?? c.name);
  return `${label}(${arg.length > 80 ? arg.slice(0, 80) + "…" : arg})`;
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
  return all.length > lines ? `${head}\n${styleText("dim", `… +${all.length - lines} lines`)}` : head;
}

/**
 * Tiny Markdown → ANSI renderer: headings, bold, italics, inline code, fenced code, lists, quotes.
 * Good enough for model output in a terminal; not a full CommonMark implementation.
 */
export function renderMarkdown(md: string): string {
  const out: string[] = [];
  let fence: { marker: string; language: string } | undefined;
  let code: string[] = [];
  const flushCode = () => {
    if (code.length) out.push(highlightCode(code.join("\n"), fence?.language).split("\n").map((line) => `  ${line}`).join("\n"));
    code = [];
  };
  for (const line of md.split("\n")) {
    const marker = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (marker && marker[1]![0] === fence.marker[0] && marker[1]!.length >= fence.marker.length && !marker[2]!.trim()) {
        flushCode();
        fence = undefined;
      } else code.push(line);
      continue;
    }
    if (marker) {
      fence = { marker: marker[1]!, language: marker[2]!.trim().split(/\s+/)[0]! };
      continue;
    }
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) out.push(styleText("bold", inline(m[2]!)));
    else if ((m = line.match(/^(\s*)[-*+]\s+(.*)$/))) out.push(`${m[1]}• ${inline(m[2]!)}`);
    else if ((m = line.match(/^>\s?(.*)$/))) out.push(styleText(["dim", "italic"], `│ ${inline(m[1]!)}`));
    else if (/^\s*([-*_])\1{2,}\s*$/.test(line)) out.push(styleText("dim", "─".repeat(40)));
    else out.push(inline(line));
  }
  flushCode(); // Also render an unfinished fence while a reply is streaming.
  return out.join("\n");
}

function inline(s: string): string {
  return s
    .replace(/`([^`]+)`/g, (_, c) => styleText("cyan", c))
    .replace(/\*\*([^*]+)\*\*/g, (_, t) => styleText("bold", t))
    .replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\w)/g, (_, p, t) => p + styleText("italic", t));
}

/** Index just past the last paragraph break outside a code fence, or -1. Used to flush streamed text. */
export function lastSafeBreak(text: string): number {
  let fence: string | undefined;
  let last = -1;
  let offset = 0;
  for (const line of text.split("\n")) {
    const marker = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (marker) {
      if (!fence) fence = marker[1]!;
      else if (marker[1]![0] === fence[0] && marker[1]!.length >= fence.length && !marker[2]!.trim()) fence = undefined;
    }
    const end = offset + line.length;
    if (!fence && text[end] === "\n" && text[end + 1] === "\n") last = end + 2;
    offset = end + 1;
  }
  return last;
}
