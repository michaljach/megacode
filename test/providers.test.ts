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

test("each API's \"too long\" rejection becomes ContextOverflowError; rate limits and other 400s don't", async () => {
  const { asContextOverflow } = await import("../src/adapters/providers/shared.ts");
  const { ContextOverflowError } = await import("../src/core/provider.ts");
  const rejected = (status: number, message: string, code?: string) => Object.assign(new Error(message), { status, code });
  for (const error of [
    rejected(400, "This model's maximum context length is 128000 tokens. However, your messages resulted in 130000 tokens."),
    rejected(400, "prompt is too long: 205000 tokens > 200000 maximum"),
    rejected(400, "The input token count (1100000) exceeds the maximum number of tokens allowed (1048576)."),
    rejected(400, "Your input exceeds the context window of this model."),
    rejected(400, "Please reduce the length of the messages or completion."),
    rejected(400, "bad request", "context_length_exceeded"),
    rejected(413, "Request exceeds the maximum size"),
  ])
    assert.ok(asContextOverflow(error) instanceof ContextOverflowError, error.message);
  for (const error of [rejected(429, "Rate limit reached: too many tokens per min (context length)"), rejected(400, "Invalid tool schema"), new Error("context window")])
    assert.equal(asContextOverflow(error), error, error.message);
});

test("overflow handling preserves unknown errors and accepts status-only rejections", async () => {
  const { asContextOverflow } = await import("../src/adapters/providers/shared.ts");
  const { ContextOverflowError } = await import("../src/core/provider.ts");
  for (const error of [null, undefined, "offline", 400, { status: "400", message: "context length" }, { status: 400, message: 123 }])
    assert.equal(asContextOverflow(error), error);
  const rejected = { status: 400, code: "context_length_exceeded" };
  const overflow = asContextOverflow(rejected);
  assert.ok(overflow instanceof ContextOverflowError);
  assert.equal(overflow.cause, rejected);
});

test("context windows come from each API's model info; a failed lookup means unknown", async () => {
  const { AnthropicProvider } = await import("../src/adapters/providers/anthropic.ts");
  const { GeminiProvider } = await import("../src/adapters/providers/gemini.ts");
  const { withOverflowErrors } = await import("../src/adapters/providers/shared.ts");

  const anthropic = new AnthropicProvider("test");
  anthropic.client.models.retrieve = (async () => ({ max_input_tokens: 200_000 })) as any;
  assert.equal(await anthropic.contextWindow("claude"), 200_000);

  const gemini = new GeminiProvider("test");
  let lookups = 0;
  gemini.client.models.get = (async () => (lookups++, { inputTokenLimit: 1_048_576 })) as any;
  assert.equal(await gemini.contextWindow("gemini-2.5-pro"), 1_048_576);
  await gemini.contextWindow("gemini-2.5-pro");
  assert.equal(lookups, 1, "looked up once per model");

  const { OpenAIProvider } = await import("../src/adapters/providers/openai.ts");
  const compatible = new OpenAIProvider({ apiKey: "test" });
  const listed = [{ id: "openrouter", context_length: 64_000 }, { id: "vllm", max_model_len: 32_768 }, { id: "llama", meta: { n_ctx: 131_072 } }];
  compatible.client.models.list = (() => listed.values()) as any;
  assert.deepEqual(await Promise.all(listed.map((m) => compatible.contextWindow(m.id))), [64_000, 32_768, 131_072]);

  const failing = withOverflowErrors({ turn: async () => ({}) as any, listModels: async () => [], contextWindow: async () => { throw new Error("offline"); } });
  assert.equal(await failing.contextWindow!("m"), null);
  const silent = withOverflowErrors({ turn: async () => ({}) as any, listModels: async () => [] });
  assert.equal(await silent.contextWindow!("m"), null);
});
