import assert from "node:assert/strict";
import { test } from "node:test";
import { stripVTControlCharacters as plain } from "node:util";
import { previewPrompt } from "../src/ui/format.ts";

test("prompt previews preserve short text and flatten line breaks", () => {
  assert.equal(previewPrompt(""), "");
  assert.equal(previewPrompt("hello world"), "hello world");
  assert.equal(previewPrompt("one\r\ntwo\nthree\rfour\tfive"), "one ⏎ two ⏎ three ⏎ four five");
});

test("long prompt previews are capped with an ellipsis", () => {
  assert.equal(previewPrompt("x".repeat(200)), "x".repeat(200));
  assert.equal(previewPrompt("x".repeat(201)), "x".repeat(199) + "…");
  assert.equal(previewPrompt("😀".repeat(201)), "😀".repeat(199) + "…");
  assert.equal(Array.from(previewPrompt("line\n".repeat(100))).length, 200);
});

test("the transcript summarizes reads and edits; errors show as they are", async () => {
  const { displayOutput, describeChange } = await import("../src/ui/format.ts");
  const read = { id: "1", name: "read_file", input: { path: "a" } };
  assert.equal(plain(displayOutput(read, { output: "1\talpha\n2\tbeta", isError: false })), "Read 2 lines");
  assert.equal(plain(displayOutput(read, { output: "1\ta\n[1450 lines total; continue with offset=2]", isError: false })), "Read 1 of 1,450 lines");
  assert.equal(plain(displayOutput(read, { output: "Error: ENOENT", isError: true })), "Error: ENOENT");
  const edit = { id: "2", name: "edit_file", input: { path: "a" } };
  assert.equal(plain(displayOutput(edit, { output: "Edited /abs/a", isError: false, change: { file: "a", before: "x\ny\n", after: "x\nY\nz\n" } })), "Added 2 lines, removed 1 line");
  assert.equal(plain(describeChange({ file: "a", before: "", after: "one\n" })), "Added 1 line");
  assert.equal(plain(describeChange({ file: "a", before: "same", after: "same" })), "No changes");
  assert.equal(plain(displayOutput({ id: "3", name: "bash", input: {} }, { output: "built", isError: false })), "built");
});
