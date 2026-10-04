import { stripVTControlCharacters, styleText } from "node:util";

/**
 * Tiny Markdown → ANSI renderer: headings, bold, italics, inline code, fenced code, lists, quotes.
 * Good enough for model output in a terminal; not a full CommonMark implementation.
 */
export function renderMarkdown(md: string): string {
  const out: string[] = [];
  let fence: string | undefined;
  for (const line of md.split("\n")) {
    const next = fenceAfter(fence, line);
    if (fence !== undefined || next !== undefined) {
      // Code is indented; control characters are dropped so a reply can't restyle the terminal.
      if (fence !== undefined && next !== undefined) out.push(`  ${stripVTControlCharacters(line)}`);
      fence = next;
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

/** The fence open after `line`: a line of ``` or ~~~ opens one; the same marker, at least as long, closes it. */
function fenceAfter(open: string | undefined, line: string): string | undefined {
  const m = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
  if (!m) return open;
  if (open === undefined) return m[1];
  return m[1]![0] === open[0] && m[1]!.length >= open.length && !m[2]!.trim() ? undefined : open;
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
    fence = fenceAfter(fence, line);
    const end = offset + line.length;
    if (!fence && text[end] === "\n" && text[end + 1] === "\n") last = end + 2;
    offset = end + 1;
  }
  return last;
}
