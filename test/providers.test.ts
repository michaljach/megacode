import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { resolveModel } from "../src/adapters/providers/registry.ts";
import { setConfigDir } from "../src/adapters/storage.ts";

const KEY_VARS = ["OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"];

test("a model can be chosen before its provider has credentials, so /login can follow", (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "providers-test-"));
  const saved = Object.fromEntries(KEY_VARS.map((k) => [k, process.env[k]]));
  const warn = console.warn;
  const warnings: unknown[] = [];
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    console.warn = warn;
    rmSync(dir, { recursive: true, force: true });
  });
  for (const k of KEY_VARS) delete process.env[k];
  setConfigDir(dir);
  console.warn = (...args: unknown[]) => void warnings.push(args);

  for (const spec of ["openai:gpt-5", "gemini:gemini-2.5-pro", "anthropic:claude-opus-5"])
    assert.doesNotThrow(() => resolveModel(spec), spec);
  assert.deepEqual(warnings, [], "nothing is printed over the TUI");
});
