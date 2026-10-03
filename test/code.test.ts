import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { stripVTControlCharacters as plain } from "node:util";
import { fileLanguage, highlightCode, renderFileChange } from "../src/ui/code.ts";
import { lastSafeBreak, renderMarkdown } from "../src/ui/format.ts";

test("language lookup and plain fallback preserve source", () => {
  assert.equal(fileLanguage("src/App.tsx"), "typescript");
  assert.equal(fileLanguage("Dockerfile"), "dockerfile");
  assert.equal(fileLanguage("script.py"), "python");
  assert.equal(highlightCode("some <unknown> text", "not-a-language"), "some <unknown> text");
  assert.equal(plain(highlightCode('const x = "hello";', "typescript")), 'const x = "hello";');
  assert.equal(highlightCode("\u001b[2Jhello", "text"), "hello");
});

test("code highlighting emits multiple token colors in a color terminal", () => {
  const output = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
    `import { highlightCode } from './src/ui/code.ts'; console.log(highlightCode('const x = "hello";', 'typescript'));`],
  { env: { ...process.env, FORCE_COLOR: "1", NO_COLOR: undefined }, encoding: "utf8" });
  assert.ok(new Set(output.match(/\u001b\[\d+m/g)).size >= 3);
});

test("Markdown highlights whole fences, including unfinished and tilde fences", () => {
  assert.equal(plain(renderMarkdown('Before\n```ts\nconst x = 1;\n```\nAfter')), "Before\n  const x = 1;\nAfter");
  assert.equal(plain(renderMarkdown('~~~unknown\n**literal**\n\nend')), "  **literal**\n  \n  end");
  assert.equal(plain(renderMarkdown('````ts\n```\n````')), "  ```");
  assert.equal(lastSafeBreak('before\n\n  ~~~ts\na\n\nb'), 8);
  assert.equal(lastSafeBreak('```ts\na\n\nb'), -1);
  assert.equal(lastSafeBreak('~~~ts\nx\n~~~\n\nend'), 13);
});

test("diffs include real line numbers, context, and both sides of replacements", () => {
  const diff = plain(renderFileChange("a.ts", "unchanged\nconst x = 1;\ntail\n", "unchanged\nconst x = 2;\ntail\n"));
  assert.doesNotMatch(diff, /@@|⋮/); // one hunk: the line numbers say where it is
  assert.match(diff, /1\s+1\s+ unchanged/);
  assert.match(diff, /2\s+- const x = 1;/);
  assert.match(diff, /2 \+ const x = 2;/);
  assert.equal(renderFileChange("a", "same", "same"), "No content changes.");
  assert.match(plain(renderFileChange("a", "", "new\n")), /1 \+ new/);
  assert.match(plain(renderFileChange("a", "old\n", "")), /1\s+- old/);
  const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
  const twoHunks = plain(renderFileChange("a", lines.join("\n"), lines.map((l, i) => (i === 1 || i === 17 ? l + "!" : l)).join("\n")));
  assert.match(twoHunks, /- line 2\n[\s\S]*\n {3}⋮ {4}⋮\n[\s\S]*- line 18\n/);
});

test("diff backgrounds cover the gutter and source without token color overrides", () => {
  const output = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
    `import { renderFileChange } from './src/ui/code.ts'; console.log(renderFileChange('a.ts', 'const x = 1;\\n\\nkeep\\n', 'const x = 2;\\nadded\\nkeep\\n'));`],
  { env: { ...process.env, FORCE_COLOR: "1", NO_COLOR: undefined }, encoding: "utf8" });
  const lines = output.trimEnd().split("\n");
  for (const [marker, background] of [["-", 41], ["+", 42]] as const) {
    const changed = lines.filter((line) => /^\s*\d*\s+\d*\s[+-] /.test(plain(line)) && plain(line).includes(`${marker} `));
    assert.equal(changed.length, 2);
    for (const line of changed) {
      assert.ok(line.startsWith(`\u001b[${background}m\u001b[37m`), JSON.stringify(line));
      assert.ok(line.endsWith("\u001b[39m\u001b[49m"), JSON.stringify(line));
      assert.equal(line.match(/\u001b\[/g)?.length, 4, "no nested syntax colors or resets");
    }
  }
  const context = lines.find((line) => plain(line).includes("keep"))!;
  assert.ok(!/\u001b\[4[12]m/.test(context));
});

test("large previews are bounded and explicitly marked", () => {
  const diff = plain(renderFileChange("a.ts", "", "const x = 1;\n".repeat(100)));
  assert.ok(diff.split("\n").length <= 61);
  assert.match(diff, /preview truncated/);
  assert.match(renderFileChange("a", "", "x".repeat(1_000_001)), /file too large/);
  assert.match(renderFileChange("a", "", "x".repeat(300)), /…/);
});
