import assert from "node:assert/strict";
import { test } from "node:test";
import { draftToConfig, parseExtra } from "../src/adapters/mcp/config.ts";
import { detectImageType } from "../src/adapters/tools/image.ts";
import { validateArguments } from "../src/adapters/tools/validation.ts";
import { parseCliArgs } from "../src/args.ts";
import { parseModelSpec } from "../src/core/provider.ts";

test("image types come from magic bytes", () => {
  assert.equal(detectImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), "image/png");
  assert.equal(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(detectImageType(Buffer.from("GIF89a...")), "image/gif");
  assert.equal(detectImageType(Buffer.from("RIFF\0\0\0\0WEBPVP8 ")), "image/webp");
  assert.equal(detectImageType(Buffer.from("not an image")), undefined);
  assert.equal(detectImageType(Buffer.alloc(0)), undefined);
});

test("arguments are checked against type and minimum", () => {
  const schema = {
    type: "object" as const,
    properties: { path: { type: "string" }, offset: { type: "integer", minimum: 1 }, timeout: { type: "integer", minimum: 0 } },
    required: ["path"],
  };
  assert.deepEqual(validateArguments({ path: "a", timeout: 0 }, schema), { path: "a", timeout: 0 });
  assert.throws(() => validateArguments({}, schema), /Missing required arguments: path/);
  assert.throws(() => validateArguments({ path: 1 }, schema), /path must be a string/);
  assert.throws(() => validateArguments({ path: "a", offset: 1.5 }, schema), /offset must be an integer/);
  assert.throws(() => validateArguments({ path: "a", offset: 0 }, schema), /offset must be at least 1/);
  assert.throws(() => validateArguments({ _invalid_json: "{" }, schema), /not valid JSON/);
  assert.throws(() => validateArguments([], schema), /JSON object/);
});

test("model specs split on the first colon only", () => {
  assert.deepEqual(parseModelSpec("ollama:qwen3:8b"), { provider: "ollama", model: "qwen3:8b" });
  assert.deepEqual(parseModelSpec("anthropic"), { provider: "anthropic" });
});

test("cli args parse model, ask, host, port, and prompt", () => {
  assert.equal(parseCliArgs(["-m", "openai:gpt-5"]).model, "openai:gpt-5");
  assert.equal(parseCliArgs(["-m", "openai:gpt-5", "--ask"]).ask, true);
  assert.equal(parseCliArgs(["-m", "openai:gpt-5", "--ask"]).prompt, "");
  assert.equal(parseCliArgs(["-m", "openai:gpt-5"]).help, false);
  assert.equal(parseCliArgs(["-m", "openai:gpt-5", "-H", "127.0.0.1"]).host, "127.0.0.1");
  assert.equal(parseCliArgs(["-m", "openai:gpt-5", "-H", "127.0.0.1", "-p", "8080"]).host, "127.0.0.1");
  assert.equal(parseCliArgs(["-m", "openai:gpt-5", "-p", "8080"]).port, 8080);
  assert.equal(parseCliArgs(["-m", "openai:gpt-5", "-p", "0"]).port, 0);
  assert.equal(parseCliArgs(["hello world"]).prompt, "hello world");
  assert.equal(parseCliArgs([]).prompt, "");
  assert.throws(() => parseCliArgs(["-p", "99999"]), /99999/);
});

test("MCP drafts become server configs", () => {
  assert.deepEqual(draftToConfig({ type: "stdio", target: `npx -y "@scope/pkg"`, extras: {} }), { command: "npx", args: ["-y", "@scope/pkg"] });
  assert.deepEqual(draftToConfig({ type: "http", target: "https://x/mcp", extras: { Authorization: "Bearer t" } }), {
    type: "http", url: "https://x/mcp", headers: { Authorization: "Bearer t" },
  });
  assert.deepEqual(parseExtra("stdio", "TOKEN=a=b"), ["TOKEN", "a=b"]);
  assert.deepEqual(parseExtra("sse", "Authorization: Bearer t"), ["Authorization", "Bearer t"]);
  assert.equal(parseExtra("stdio", "nope"), null);
});
