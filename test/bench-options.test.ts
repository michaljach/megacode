import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const runner = fileURLToPath(new URL("../bench/run.ts", import.meta.url));
for (const [args, message] of [
  [["--effort", "invalid"], /unique selection/],
  [["--effort", "low", "--effort", "low"], /unique selection/],
  [["--effort", "low", "--baseline"], /only supported for megacode/],
  [["--effort", "medium", "--command", '["unused"]'], /only supported for megacode/],
] as const) {
  test(`benchmark rejects unsupported effort options: ${args.join(" ")}`, () => {
    const result = spawnSync(process.execPath, ["--import", "tsx", runner, "--model", "openai:test", ...args], {
      encoding: "utf8", timeout: 15_000,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, message);
    assert.doesNotMatch(result.stdout, /Results:/, "must reject before creating workspaces or invoking a model");
  });
}
