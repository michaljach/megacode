import assert from "node:assert/strict";
import { test } from "node:test";
import { stripVTControlCharacters as plain } from "node:util";
import { lastSafeBreak, renderMarkdown } from "../src/ui/text/markdown.ts";

test("Markdown highlights whole fences, including unfinished and tilde fences", () => {
  assert.equal(plain(renderMarkdown('Before\n```ts\nconst x = 1;\n```\nAfter')), "Before\n  const x = 1;\nAfter");
  assert.equal(plain(renderMarkdown('~~~unknown\n**literal**\n\nend')), "  **literal**\n  \n  end");
  assert.equal(plain(renderMarkdown('````ts\n```\n````')), "  ```");
  assert.equal(lastSafeBreak('before\n\n  ~~~ts\na\n\nb'), 8);
  assert.equal(lastSafeBreak('```ts\na\n\nb'), -1);
  assert.equal(lastSafeBreak('~~~ts\nx\n~~~\n\nend'), 13);
});

