import assert from "node:assert/strict";
import { test } from "node:test";
import { lineBounds, verticalMove, wordEnd, wordStart } from "../src/ui/prompt/editing.ts";

const text = "first line\nab\nthird line";

test("lineBounds spans the cursor's line, up to but not including its newline", () => {
  assert.deepEqual(lineBounds(text, 3), { start: 0, end: 10 });
  assert.deepEqual(lineBounds(text, 12), { start: 11, end: 13 });
  assert.deepEqual(lineBounds(text, text.length), { start: 14, end: 24 });
});

test("vertical moves keep the column, or stop at the end of a shorter line", () => {
  assert.equal(verticalMove(text, 16, -1), 13); // column 2 on line 3 → end of "ab"
  assert.equal(verticalMove(text, 12, -1), 1); // column 1 on "ab" → column 1 on line 1
  assert.equal(verticalMove(text, 8, 1), 13); // column 8 on line 1 → end of "ab"
  assert.equal(verticalMove(text, 12, 1), 15);
});

test("vertical moves past the first or last line leave the cursor where it is", () => {
  assert.equal(verticalMove(text, 3, -1), 3);
  assert.equal(verticalMove(text, 20, 1), 20);
});

test("word moves skip whitespace, then the word", () => {
  assert.equal(wordStart("npm run  test", 13), 9);
  assert.equal(wordStart("npm run  test", 9), 4);
  assert.equal(wordEnd("npm run  test", 3), 7);
  assert.equal(wordEnd("npm run  test", 7), 13);
  assert.equal(wordStart("", 0), 0);
});
