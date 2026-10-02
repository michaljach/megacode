import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { builtinTools } from "../src/adapters/tools/index.ts";
import { elideMiddle, filePage, OUTPUT_CHARS } from "../src/adapters/tools/output.ts";

test("small outputs remain intact; long outputs retain both ends", () => {
  assert.equal(elideMiddle("hello"), "hello");
  const text = "start" + "x".repeat(30_000) + "failure at end";
  const preview = elideMiddle(text);
  assert.ok(preview.startsWith("start"));
  assert.ok(preview.endsWith("failure at end"));
  assert.ok(preview.length < OUTPUT_CHARS + 100);
});

test("file pages preserve source and give exact continuation offsets", () => {
  const text = Array.from({ length: 450 }, (_, i) => `line ${i + 1}`).join("\n");
  const first = filePage(text);
  assert.ok(first.startsWith("1\tline 1\n"));
  assert.ok(first.includes("200\tline 200\n"));
  assert.ok(first.endsWith("[450 lines total; continue with offset=201]"));
  assert.ok(filePage(text, 201).startsWith("201\tline 201\n"));
  assert.equal(filePage(text, 450), "450\tline 450");
  assert.equal(filePage(text, 451), "[EOF: 450 lines]");
});

test("character budget never silently splits a line", () => {
  const line = "x".repeat(OUTPUT_CHARS + 1);
  assert.equal(filePage(line + "\nnext"), `1\t${line}\n[2 lines total; continue with offset=2]`);
  assert.equal(filePage(line + "\nnext", 2), "2\tnext");
  for (const value of [0, -1, 1.5, NaN, Infinity]) {
    assert.throws(() => filePage("abc", value));
    assert.throws(() => filePage("abc", 1, value));
  }
});

test("long command output is recoverable and keeps exit status", async () => {
  const command = `${JSON.stringify(process.execPath)} -e 'console.log("x".repeat(30000)); console.log("FINAL FAILURE"); process.exit(2)'`;
  const result = await builtinTools.execute({ id: "1", name: "bash", input: { command } }, { approve: async () => true });
  assert.equal(result.isError, true);
  assert.ok(result.output.includes("FINAL FAILURE"));
  assert.ok(result.output.endsWith("[exit code 2]"));
  const file = result.output.match(/\[Full output: (.*); read_file/)?.[1];
  assert.ok(file);
  try {
    assert.equal(await readFile(file, "utf8"), "x".repeat(30000) + "\nFINAL FAILURE\n");
  } finally {
    await rm(path.dirname(file), { recursive: true });
  }
});

test("permission denial still prevents execution", async () => {
  const result = await builtinTools.execute({ id: "1", name: "bash", input: { command: "echo should-not-run" } }, { approve: async () => false });
  assert.equal(result.output, "User denied the command.");
});
