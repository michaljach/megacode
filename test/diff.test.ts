import assert from "node:assert/strict";
import { test } from "node:test";
import { stripVTControlCharacters as plain } from "node:util";
import chalk from "chalk";
import { buildDiff, diffToAnsi, gutter, pieces, type LineRow } from "../src/ui/diff.ts";

// Layouts here were measured from Claude Code 2.1.288's own rendering of the same edits.

const MATH = `// Small helpers used by the calculator.
export function add(a: number, b: number): number {
  return a + b;
}

export function multiply(a: number, b: number): number {
  const product = a * b;
  return product;
}

export const PI = 3.14159;
`;

test("an edit: one line-number column, signs, three lines of context", () => {
  const model = buildDiff({ file: `${process.cwd()}/math.ts`, before: MATH, after: MATH.replace("  const product = a * b;\n  return product;", "  return a * b;") })!;
  assert.equal(model.file, "math.ts");
  assert.deepEqual([model.added, model.removed, model.numberWidth, model.hidden], [1, 2, 2, 0]);
  assert.deepEqual(model.rows.map((r) => gutter(r, model) + (r as LineRow).text), [
    "  4  }", "  5  ", "  6  export function multiply(a: number, b: number): number {",
    "  7 -  const product = a * b;", "  8 -  return product;", "  7 +  return a * b;",
    "  8  }", "  9  ", " 10  export const PI = 3.14159;",
  ]);
  assert.ok(model.rows.every((r) => !(r as LineRow).marks), "2 lines into 1: too different for word marks");
});

test("changed words in a replaced line are marked", () => {
  const model = buildDiff({ file: "a.ts", before: "let count = 0;\nreturn label;\n", after: "let count = 1;\nreturn label.trim();\n" })!;
  const changed = (model.rows as LineRow[]).map((r) => pieces(r).filter((p) => p.changed).map((p) => p.text).join(""));
  assert.deepEqual(changed, ["0", "", "1", ".trim()"]);
  assert.deepEqual(pieces({ type: "context", number: 1, text: "" }), [{ text: "", changed: false }]);
});

test("a new file lists its lines without signs, bounded with a count of the rest", () => {
  const content = ["// Fresh file", ...Array.from({ length: 12 }, (_, i) => `export const v${i + 1} = ${i + 1};`), 'export default "done";'].join("\n") + "\n";
  const model = buildDiff({ file: "fresh.ts", before: "", after: content, created: true }, 10)!;
  assert.deepEqual([model.created, model.added, model.rows.length, model.hidden, model.numberWidth], [true, 14, 10, 4, 2]);
  assert.equal(gutter(model.rows[0]!, model), "  1 ");
  assert.match(plain(diffToAnsi(model, 40)), /^ {2}1 \/\/ Fresh file\n[\s\S]* 10 export const v9 = 9;\n… \+4 lines$/);
  assert.equal(buildDiff({ file: "empty.ts", before: "", after: "", created: true })!.added, 0);
});

test("separate hunks are divided, and huge files aren't diffed", () => {
  const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
  const model = buildDiff({ file: "a.txt", before: lines.join("\n"), after: lines.map((l, i) => (i === 1 || i === 17 ? l + "!" : l)).join("\n") })!;
  assert.equal(model.rows.filter((r) => r.type === "gap").length, 1);
  assert.equal(buildDiff({ file: "a", before: "", after: "x".repeat(1_000_001) }), null);
});

test("plain output paints changed rows red and green across the full width, changed words brighter", () => {
  const level = chalk.level;
  chalk.level = 3;
  try {
    const model = buildDiff({ file: "a.txt", before: "a\nkeep b\n", after: "a\nkeep c\n" })!;
    const [, removed, added] = diffToAnsi(model, 30).split("\n");
    const rows = [[removed!, "38;2;220;90;90", "48;2;61;1;0", "48;2;92;2;0"], [added!, "38;2;80;200;80", "48;2;2;40;0", "48;2;4;71;0"]] as const;
    for (const [line, fg, bg, word] of rows) {
      assert.equal(plain(line).length, 30);
      for (const code of [fg, bg, word]) assert.ok(line.includes(`\u001b[${code}m`), `${code} in ${JSON.stringify(line)}`);
      // The code itself is colored, not just the gutter.
      assert.ok(line.includes(`\u001b[${fg}mkeep `), JSON.stringify(line));
    }
    const context = diffToAnsi(model, 30).split("\n")[0]!;
    assert.ok(!context.includes("\u001b[38;2"), "context lines stay plain");
  } finally {
    chalk.level = level;
  }
});
