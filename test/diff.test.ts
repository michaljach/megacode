import assert from "node:assert/strict";
import { test } from "node:test";
import { stripVTControlCharacters as plain } from "node:util";
import chalk from "chalk";
import { buildDiff, diffToAnsi, gutter, type LineRow } from "../src/ui/diff.ts";
import { CODE, fileLanguage, highlightCode, highlightLines, loadLanguage } from "../src/ui/syntax.ts";

// Colors and layouts here were measured from Claude Code 2.1.288's own rendering of the same edits.

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
const text = (row: LineRow) => row.segments.map((s) => s.text).join("");
const colors = (row: LineRow) => row.segments.filter((s) => s.text.trim()).map((s) => [s.text.trim(), s.color ?? CODE, s.background]);

test("file languages, and plain text for Markdown and unknown files", () => {
  assert.equal(fileLanguage("src/App.tsx"), "tsx");
  assert.equal(fileLanguage("a/b.mts"), "typescript");
  assert.equal(fileLanguage("Dockerfile"), "docker");
  assert.equal(fileLanguage("script.py"), "python");
  assert.equal(fileLanguage("notes.md"), undefined);
  assert.equal(fileLanguage("data.unknown"), undefined);
  assert.equal(highlightCode("some <unknown> text", "not-a-language"), "some <unknown> text");
  assert.equal(highlightCode("\u001b[2Jhello", "text"), "hello", "control characters in model output are removed");
});

test("TypeScript tokens get Claude Code's colors", async () => {
  await loadLanguage("typescript");
  const [signature, , , declaration, template, call] = highlightLines(
    [
      "export function multiply(a: number, b: number): number {",
      "  return a * b;",
      "}",
      'const DEFAULT_COLOR = "#ff0000";',
      "const label = `${shape.name} (${shape.area().toFixed(2)})`;",
      "console.log(label, DEFAULT_COLOR, count); // done",
    ].join("\n"),
    "typescript",
  )!;
  const pick = (line: { text: string; color?: string }[]) => line.filter((s) => s.text.trim()).map((s) => `${s.text.trim()} ${s.color ?? "plain"}`);
  assert.deepEqual(pick(signature!), [
    "export #f92672", "function #66d9ef", "multiply #a6e22e", "( plain", "a #a6e22e", ": #fd971f", "number #a6e22e", ", #fd971f",
    "b #a6e22e", ": #fd971f", "number #a6e22e", ") plain", ": plain", "number #a6e22e", "{ plain",
  ]);
  assert.deepEqual(pick(declaration!), ["const #66d9ef", "DEFAULT_COLOR #ffffff", "= plain", '" #e6db74', "#ff0000 #e6db74", '" #e6db74', "; plain"]);
  // Inside ${…} only numbers are colored; `label` is an ordinary name, not a constant.
  assert.deepEqual(pick(template!).filter((t) => !t.endsWith("plain")), ["const #66d9ef", "` #e6db74", "( #e6db74", "2 #be84ff", ") #e6db74", "` #e6db74"]);
  assert.deepEqual(pick(call!).filter((t) => !t.endsWith("plain")), ["console #ffffff", "log #a6e22e", "DEFAULT_COLOR #ffffff", "// #75715e", "done #75715e"]);
});

test("an edit: one line-number column, plain removed lines, highlighted additions", async () => {
  await loadLanguage("typescript");
  const model = buildDiff({ file: `${process.cwd()}/math.ts`, before: MATH, after: MATH.replace("  const product = a * b;\n  return product;", "  return a * b;") })!;
  assert.equal(model.file, "math.ts");
  assert.deepEqual([model.added, model.removed, model.numberWidth, model.hidden], [1, 2, 2, 0]);
  const rows = model.rows as LineRow[];
  assert.deepEqual(rows.map((r) => gutter(r, model) + text(r)), [
    "  4  }", "  5  ", "  6  export function multiply(a: number, b: number): number {",
    "  7 -  const product = a * b;", "  8 -  return product;", "  7 +  return a * b;",
    "  8  }", "  9  ", " 10  export const PI = 3.14159;",
  ]);
  assert.deepEqual(colors(rows.find((r) => r.type === "remove")!), [["const product = a * b;", CODE, undefined]], "removed lines aren't highlighted");
  assert.deepEqual(colors(rows.find((r) => r.type === "add")!)[0], ["return", "#f92672", undefined]);
  assert.ok(rows.every((r) => r.segments.every((s) => !s.background)), "2 lines into 1: too different for word marks");
});

test("changed words in a replaced line get a brighter background", async () => {
  await loadLanguage("typescript");
  const model = buildDiff({ file: "a.ts", before: "let count = 0;\nreturn label;\n", after: "let count = 1;\nreturn label.trim();\n" })!;
  const marked = (model.rows as LineRow[]).map((r) => {
    const parts = r.segments.filter((s) => s.background);
    return [parts.map((s) => s.text).join(""), [...new Set(parts.map((s) => s.background))].join()];
  });
  assert.deepEqual(marked, [["0", "#5c0200"], ["", ""], ["1", "#044700"], [".trim()", "#044700"]]);
});

test("a new file lists its lines without signs, the transcript showing the first 10", async () => {
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

test("plain output paints changed rows across the full width", () => {
  const level = chalk.level;
  chalk.level = 3;
  try {
    const model = buildDiff({ file: "a.txt", before: "a\nb\n", after: "a\nc\n" })!;
    const [, removed, added] = diffToAnsi(model, 30).split("\n");
    for (const [line, bg] of [[removed!, "48;2;61;1;0"], [added!, "48;2;2;40;0"]] as const) {
      assert.equal(plain(line).length, 30);
      assert.ok(line.includes(`\u001b[${bg}m`), JSON.stringify(line));
    }
  } finally {
    chalk.level = level;
  }
});
