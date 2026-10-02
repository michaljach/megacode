import assert from "node:assert/strict";
import { test } from "node:test";
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
