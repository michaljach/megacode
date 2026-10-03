import { relative } from "node:path";
import chalk from "chalk";
import { diffWordsWithSpace, structuredPatch } from "diff";
import type { FileChange } from "../core/tools.ts";

// A file change as Claude Code shows it: one line-number column, removed lines on red and added lines
// on green (the changed words brighter), unchanged context around them. New files are listed whole.

export const DIFF_COLORS = {
  removedNumber: "#dc5a5a",
  removed: "#3d0100",
  removedWord: "#5c0200",
  addedNumber: "#50c850",
  added: "#022800",
  addedWord: "#044700",
  muted: "#999999",
};

/** A numbered line: added, removed, unchanged context, or a line of a new file. `marks`: changed words. */
export type LineRow = { type: "add" | "remove" | "context" | "line"; number: number; text: string; marks?: [number, number][] };
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

const MAX_COMPARE = 1_000_000; // characters; larger files aren't diffed

/** Marks the words that changed between a replaced line and its replacement, unless they're mostly different. */
function markChangedWords(removed: LineRow, added: LineRow) {
  const parts = diffWordsWithSpace(removed.text, added.text);
  const same = parts.filter((p) => !p.added && !p.removed).reduce((n, p) => n + p.value.length, 0);
  if (same < Math.max(removed.text.length, added.text.length) / 2) return;
  for (const [row, side] of [[removed, "removed"], [added, "added"]] as const) {
    row.marks = [];
    let at = 0;
    for (const p of parts) {
      if (p[side === "added" ? "removed" : "added"]) continue; // the other side's text
      if (p[side]) row.marks.push([at, at + p.value.length]);
      at += p.value.length;
    }
  }
}

/** The rows to show for a change, at most `maxRows`. Null when the files are too large to compare. */
export function buildDiff(change: FileChange, maxRows = 60): DiffModel | null {
  if (change.before.length + change.after.length > MAX_COMPARE) return null;
  const file = relative(process.cwd(), change.file) || change.file;
  const bounded = (rows: DiffRow[], rest: Omit<DiffModel, "file" | "rows" | "hidden">): DiffModel => ({
    file,
    rows: rows.slice(0, maxRows),
    hidden: Math.max(0, rows.length - maxRows),
    ...rest,
  });

  if (change.created) {
    const lines = change.after === "" ? [] : change.after.replace(/\n$/, "").split("\n");
    const rows = lines.map((text, i): LineRow => ({ type: "line", number: i + 1, text }));
    return bounded(rows, { created: true, numberWidth: String(lines.length).length, added: lines.length, removed: 0 });
  }

  const patch = structuredPatch(file, file, change.before, change.after, undefined, undefined, { context: 3, timeout: 200 });
  if (!patch) return null;
  const rows: DiffRow[] = [];
  let [added, removed, widest] = [0, 0, 0];
  for (const [h, hunk] of patch.hunks.entries()) {
    if (h > 0) rows.push({ type: "gap" });
    let [oldNo, newNo] = [hunk.oldStart, hunk.newStart];
    const lines = hunk.lines.filter((l) => !l.startsWith("\\")); // "\ No newline at end of file"
    for (let i = 0; i < lines.length; ) {
      if (lines[i]![0] === " ") {
        rows.push({ type: "context", number: newNo++, text: lines[i++]!.slice(1) });
        oldNo++;
        continue;
      }
      // A block of removals then additions; same-sized blocks are line-for-line replacements.
      const minus: LineRow[] = [];
      const plus: LineRow[] = [];
      for (; lines[i]?.[0] === "-"; i++) minus.push({ type: "remove", number: oldNo++, text: lines[i]!.slice(1) });
      for (; lines[i]?.[0] === "+"; i++) plus.push({ type: "add", number: newNo++, text: lines[i]!.slice(1) });
      if (minus.length === plus.length) minus.forEach((m, k) => markChangedWords(m, plus[k]!));
      rows.push(...minus, ...plus);
      [removed, added] = [removed + minus.length, added + plus.length];
    }
    widest = Math.max(widest, oldNo - 1, newNo - 1);
  }
  return bounded(rows, { created: false, numberWidth: String(widest).length, added, removed });
}

/** The gutter for a row: a space, the line number, a space, and the sign (none for new files). */
export function gutter(row: DiffRow, model: DiffModel): string {
  if (row.type === "gap") return " ".repeat(model.numberWidth + (model.created ? 2 : 3));
  const sign = model.created ? "" : row.type === "add" ? "+" : row.type === "remove" ? "-" : " ";
  return ` ${String(row.number).padStart(model.numberWidth)} ${sign}`;
}

/** Background and line-number color for each kind of row. */
export function rowStyle(row: LineRow) {
  if (row.type === "add") return { background: DIFF_COLORS.added, word: DIFF_COLORS.addedWord, number: DIFF_COLORS.addedNumber };
  if (row.type === "remove") return { background: DIFF_COLORS.removed, word: DIFF_COLORS.removedWord, number: DIFF_COLORS.removedNumber };
  return {};
}

/** A row's text in pieces, each marked if it's a changed word. */
export function pieces(row: LineRow): { text: string; changed: boolean }[] {
  const out: { text: string; changed: boolean }[] = [];
  let at = 0;
  for (const [start, end] of row.marks ?? []) {
    if (start > at) out.push({ text: row.text.slice(at, start), changed: false });
    out.push({ text: row.text.slice(start, end), changed: true });
    at = end;
  }
  if (at < row.text.length || !out.length) out.push({ text: row.text.slice(at), changed: false });
  return out;
}

/** The diff as ANSI text `width` columns wide, for plain (non-TUI) output. */
export function diffToAnsi(model: DiffModel, width = process.stdout.columns || 80): string {
  const lines = model.rows.map((row) => {
    const head = gutter(row, model);
    if (row.type === "gap") return chalk.hex(DIFF_COLORS.muted)(head + "…");
    const style = rowStyle(row);
    const bg = (color: string | undefined, text: string) => (color ? chalk.bgHex(color)(text) : text);
    const body = pieces(row).map((p) => bg(p.changed ? style.word : style.background, p.text)).join("");
    const padding = bg(style.background, " ".repeat(Math.max(0, width - head.length - row.text.length)));
    return bg(style.background, style.number ? chalk.hex(style.number)(head) : head) + body + (style.background ? padding : "");
  });
  if (model.hidden) lines.push(chalk.hex(DIFF_COLORS.muted)(`… +${model.hidden} lines`));
  return lines.join("\n");
}
