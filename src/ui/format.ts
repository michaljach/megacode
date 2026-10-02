import { styleText } from "node:util";
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
  let inFence = false;
  for (const line of md.split("\n")) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      out.push(styleText("cyan", `  ${line}`));
      continue;
    }
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) out.push(styleText("bold", inline(m[2]!)));
    else if ((m = line.match(/^(\s*)[-*+]\s+(.*)$/))) out.push(`${m[1]}• ${inline(m[2]!)}`);
    else if ((m = line.match(/^>\s?(.*)$/))) out.push(styleText(["dim", "italic"], `│ ${inline(m[1]!)}`));
    else if (/^\s*([-*_])\1{2,}\s*$/.test(line)) out.push(styleText("dim", "─".repeat(40)));
    else out.push(inline(line));
  }
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
  let fence = false;
  let last = -1;
  for (let i = 0; i < text.length; i++) {
    if (text.startsWith("```", i) && (i === 0 || text[i - 1] === "\n")) fence = !fence;
    else if (!fence && text[i] === "\n" && text[i + 1] === "\n") last = i + 2;
  }
  return last;
}
