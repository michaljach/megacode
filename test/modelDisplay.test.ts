import assert from "node:assert/strict";
import { test } from "node:test";
import { modelDisplay } from "../src/ui/text/format.ts";

test("cloud model ids are returned unchanged", () => {
  assert.equal(modelDisplay("openai:gpt-6-astra"), "openai:gpt-6-astra");
  assert.equal(modelDisplay("anthropic:claude-opus-5"), "anthropic:claude-opus-5");
  assert.equal(modelDisplay("gemini:gemini-2.5-pro"), "gemini:gemini-2.5-pro");
});

test("bare provider names are returned unchanged", () => {
  assert.equal(modelDisplay("anthropic"), "anthropic");
});

test("path-like model ids reduce to their last path segment, keeping the provider", () => {
  assert.equal(
    modelDisplay("ollama:/home/jach/.lmstudio/models/prism-ml/Ternary-Bonsai-2-27B-gguf/Ternary-Bonsai-2-27B-gguf"),
    "ollama:Ternary-Bonsai-2-27B-gguf",
  );
});

test("model ids that contain colons but no path separators are not split", () => {
  assert.equal(modelDisplay("ollama:qwen3:8b"), "ollama:qwen3:8b");
});

test("a single absolute path segment reduces to itself with the provider prefix", () => {
  assert.equal(modelDisplay("ollama:/home/jach/only-model"), "ollama:only-model");
});

test("Windows drive-letter paths reduce to their file name", () => {
  // LM Studio on Windows reports model ids like C:\Users\…\Ternary-Bonsai-2-27B-gguf.
  const winPath = "lmstudio:" + "C:" + "\\models\\prism\\Ternary-Bonsai-2-27B-gguf";
  assert.equal(modelDisplay(winPath), "lmstudio:Ternary-Bonsai-2-27B-gguf");
});

test("OpenRouter provider/model slugs are not treated as file paths", () => {
  // These contain a slash after the colon but are model identifiers, not paths.
  assert.equal(
    modelDisplay("openrouter:anthropic/claude-3-5-sonnet-20241022"),
    "openrouter:anthropic/claude-3-5-sonnet-20241022",
  );
});

test("a relative model id with a slash is not treated as a file path", () => {
  // Starts with a letter, not "/", so it is not an absolute path.
  assert.equal(modelDisplay("ollama:models/prism"), "ollama:models/prism");
});
