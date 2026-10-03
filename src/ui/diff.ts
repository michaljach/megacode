import { relative } from "node:path";
import chalk from "chalk";
import { diffWordsWithSpace, structuredPatch } from "diff";
import type { FileChange } from "../core/tools.ts";
import { CODE, fileLanguage, highlightLines, type Segment } from "./syntax.ts";

// A file change as Claude Code shows it: one line-number column, removed lines on red, added lines on
// green with the changed words brighter, unchanged context highlighted. New files are listed whole.

export const DIFF_COLORS = {
  removedNumber: "#dc5a5a",
  removed: "#3d0100",
  removedWord: "#5c0200",
  addedNumber: "#50c850",
  added: "#022800",
  addedWord: "#044700",
  muted: "#999999",
};

/** A numbered line: added, removed, unchanged context, or a line of a new file. */
export type LineRow = { type: "add" | "remove" | "context" | "line"; number: number; segments: Segment[] };
/** `gap` separates hunks. */
export type DiffRow = LineRow | { type: "gap" };

export type DiffModel = {
  file: string;
  created: boolean;
  rows: DiffRow[];
  /** Rows left out to keep the view bounded. */
  hidden: number;
  /** Width of the line-number column. */
  numberWidth: number;
  added: number;
  removed: number;
};

const CONTEXT = 3;
const MAX_COMPARE = 1_000_000; // characters; larger files aren't diffed

/** Removed lines show as plain code; only added and context lines are highlighted. */
const plain = (text: string): Segment[] => [{ text, color: CODE }];

/**
 * Marks the words that changed between a removed line and the added line replacing it, by giving
 * those segments a brighter background. Skipped when the lines are mostly different.
 */
function markChangedWords(removed: Segment[], added: Segment[], before: string, after: string): [Segment[], Segment[]] | null {
  const parts = diffWordsWithSpace(before, after);
  const same = parts.filter((p) => !p.added && !p.removed).reduce((n, p) => n + p.value.length, 0);
  if (same < Math.max(before.length, after.length) / 2) return null;
  const ranges = (side: "added" | "removed") => {
    const out: [number, number][] = [];
    let at = 0;
    for (const p of parts) {
      if (side === "added" ? p.removed : p.added) continue;
      if (p[side]) out.push([at, at + p.value.length]);
      at += p.value.length;
    }
    return out;
  };
  return [applyMarks(removed, ranges("removed"), DIFF_COLORS.removedWord), applyMarks(added, ranges("added"), DIFF_COLORS.addedWord)];
}

/** Splits segments at range boundaries and sets `background` inside the ranges. */
function applyMarks(segments: Segment[], ranges: [number, number][], background: string): Segment[] {
  if (!ranges.length) return segments;
  const out: Segment[] = [];
  let at = 0;
  for (const seg of segments) {
    let start = 0;
    while (start < seg.text.length) {
      const pos = at + start;
      const inside = ranges.find(([a, b]) => pos >= a && pos < b);
      const next = inside ? inside[1] : Math.min(...ranges.map(([a]) => a).filter((a) => a > pos), at + seg.text.length);
      const end = Math.min(next - at, seg.text.length);
      out.push({ ...seg, text: seg.text.slice(start, end), ...(inside ? { background } : {}) });
      start = end;
    }
    at += seg.text.length;
  }
  return out;
}

/**
 * The rows to show for a change, at most `maxRows` (the rest are counted in `hidden`).
 * Returns null when the files are too large or too different to compare quickly.
 */
export function buildDiff(change: FileChange, maxRows = 60): DiffModel | null {
  const file = relative(process.cwd(), change.file) || change.file;
  if (change.before.length + change.after.length > MAX_COMPARE) return null;
  const language = fileLanguage(change.file);
  const afterLines = change.after.split("\n");
  const highlighted = highlightLines(change.after, language);
  const newLine = (n: number): Segment[] => highlighted?.[n - 1] ?? plain(afterLines[n - 1] ?? "");

  if (change.created) {
    const count = change.after === "" ? 0 : change.after.endsWith("\n") ? afterLines.length - 1 : afterLines.length;
    const shown = Math.min(count, maxRows);
    return {
      file,
      created: true,
      rows: Array.from({ length: shown }, (_, i) => ({ type: "line", number: i + 1, segments: newLine(i + 1) })),
      hidden: count - shown,
      numberWidth: String(count).length,
      added: count,
      removed: 0,
    };
  }

  const patch = structuredPatch(file, file, change.before, change.after, undefined, undefined, { context: CONTEXT, timeout: 200 });
  if (!patch) return null;
  const rows: DiffRow[] = [];
  let added = 0;
  let removed = 0;
  let widest = 0;
  for (const [h, hunk] of patch.hunks.entries()) {
    if (h > 0) rows.push({ type: "gap" });
    let oldNo = hunk.oldStart;
    let newNo = hunk.newStart;
    const lines = hunk.lines.filter((l) => !l.startsWith("\\")); // "\ No newline at end of file"
    for (let i = 0; i < lines.length; ) {
      if (lines[i]![0] === " ") {
        rows.push({ type: "context", number: newNo, segments: newLine(newNo) });
        widest = Math.max(widest, newNo);
        oldNo++, newNo++, i++;
        continue;
      }
      // A block of removals followed by additions: pair them up for word-level marks.
      const minus: LineRow[] = [];
      const plus: LineRow[] = [];
      for (; i < lines.length && lines[i]![0] === "-"; i++, oldNo++) minus.push({ type: "remove", number: oldNo, segments: plain(lines[i]!.slice(1)) });
      for (; i < lines.length && lines[i]![0] === "+"; i++, newNo++) plus.push({ type: "add", number: newNo, segments: newLine(newNo) });
      if (minus.length === plus.length)
        for (const [k, m] of minus.entries()) {
          const p = plus[k]!;
          const text = (r: Segment[]) => r.map((s) => s.text).join("");
          const marked = markChangedWords(m.segments, p.segments, text(m.segments), text(p.segments));
          if (marked) [m.segments, p.segments] = marked;
        }
      rows.push(...minus, ...plus);
      removed += minus.length;
      added += plus.length;
      widest = Math.max(widest, oldNo - 1, newNo - 1);
    }
  }
  const shown = rows.slice(0, maxRows);
  return { file, created: false, rows: shown, hidden: rows.length - shown.length, numberWidth: String(widest).length, added, removed };
}

/** The gutter for a row: a space, the line number, a space, and the sign (none for new files). */
export function gutter(row: DiffRow, model: DiffModel): string {
  if (row.type === "gap") return " ".repeat(model.numberWidth + (model.created ? 2 : 3));
  const sign = model.created ? "" : row.type === "add" ? "+" : row.type === "remove" ? "-" : " ";
  return ` ${String(row.number).padStart(model.numberWidth)} ${sign}`;
}

export const rowBackground = (row: LineRow) =>
  row.type === "add" ? DIFF_COLORS.added : row.type === "remove" ? DIFF_COLORS.removed : undefined;

export const numberColor = (row: LineRow) =>
  row.type === "add" ? DIFF_COLORS.addedNumber : row.type === "remove" ? DIFF_COLORS.removedNumber : CODE;

/** The diff as ANSI text `width` columns wide, for plain (non-TUI) output. */
export function diffToAnsi(model: DiffModel, width = process.stdout.columns || 80): string {
  const lines = model.rows.map((row) => {
    if (row.type === "gap") return chalk.hex(DIFF_COLORS.muted)(gutter(row, model) + "…");
    const bg = rowBackground(row);
    const paint = (text: string, color = CODE, background = bg) => {
      const fg = chalk.hex(color);
      return background ? fg.bgHex(background)(text) : fg(text);
    };
    const head = gutter(row, model);
    const body = row.segments.map((s) => paint(s.text, s.color, s.background ?? bg)).join("");
    const used = head.length + row.segments.reduce((n, s) => n + s.text.length, 0);
    return paint(head, numberColor(row)) + body + (bg ? paint(" ".repeat(Math.max(0, width - used))) : "");
  });
  if (model.hidden) lines.push(chalk.hex(DIFF_COLORS.muted)(`… +${model.hidden} lines`));
  return lines.join("\n");
}
