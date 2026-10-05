import assert from "node:assert/strict";
import { test } from "node:test";
import {
  commitCursor,
  freshCursor,
  moveCursor,
  type HistoryCursor,
} from "../src/ui/prompt/historyCursor.ts";

const history = ["first", "second", "third"];

/** The entry a cursor points at, or null when editing a fresh draft. */
const entry = (c: HistoryCursor): string | null => (c.pos === null ? null : history[c.pos]!);

test("up from a fresh draft starts from the newest entry and remembers the draft", () => {
  const up = moveCursor(freshCursor, -1, history, "draft");
  assert.strictEqual(up.text, "third");
  assert.deepStrictEqual(up.cursor, { pos: 2, draft: "draft" });
  assert.strictEqual(entry(up.cursor), "third");
});

test("down from a fresh draft is a no-op (nothing to return to yet)", () => {
  const down = moveCursor(freshCursor, 1, history, "draft");
  assert.strictEqual(down.text, null);
  assert.deepStrictEqual(down.cursor, freshCursor);
});

test("up at the oldest is a no-op (no older entry to return to)", () => {
  const atOldest = moveCursor(
    { pos: 0, draft: "draft" },
    -1,
    history,
    "first",
  );
  assert.strictEqual(atOldest.text, null);
  assert.deepStrictEqual(atOldest.cursor, { pos: 0, draft: "draft" });
});

test("down from the newest returns to the remembered draft and forgets navigation", () => {
  const fromNewest = moveCursor({ pos: 2, draft: "draft" }, 1, history, "third");
  assert.strictEqual(fromNewest.text, "draft");
  assert.deepStrictEqual(fromNewest.cursor, freshCursor);
});

test("down steps toward the newest when not at it", () => {
  const fromSecond = moveCursor({ pos: 1, draft: "draft" }, 1, history, "second");
  assert.strictEqual(fromSecond.text, "third");
  assert.strictEqual(fromSecond.cursor.pos, 2);
});

test("editing the text resets the cursor so the next up press restarts from the latest entry", () => {
  // Navigate down through the middle of history...
  let cursor = freshCursor;
  let r = moveCursor(cursor, -1, history, "draft");
  cursor = r.cursor;
  assert.strictEqual(cursor.pos, 2);
  r = moveCursor(cursor, -1, history, "third");
  cursor = r.cursor;
  assert.strictEqual(cursor.pos, 1); // now on "second"
  // ...then the user edits the text. The cursor is committed: navigation stops,
  // but the remembered draft stays so a later down-press can still return to it.
  cursor = commitCursor(cursor);
  assert.deepStrictEqual(cursor, { pos: null, draft: "draft" });
  // The next up press starts from the newest entry, not from "first".
  const afterEdit = moveCursor(cursor, -1, history, "edited");
  assert.strictEqual(afterEdit.text, "third");
  assert.deepStrictEqual(afterEdit.cursor, { pos: 2, draft: "edited" });
});

test("commitCursor stops navigation but keeps the remembered draft", () => {
  // All text edits route through commitCursor. It always drops the position so the
  // next arrow restarts from the newest entry, but it preserves the draft so a down-
  // press past the newest still returns to the text the user was editing.
  assert.strictEqual(commitCursor(freshCursor).pos, null);
  assert.strictEqual(commitCursor({ pos: 5, draft: "x" }).pos, null);
  assert.strictEqual(commitCursor({ pos: 5, draft: "x" }).draft, "x");
  assert.strictEqual(commitCursor({ pos: 0, draft: "" }).pos, null);
});
