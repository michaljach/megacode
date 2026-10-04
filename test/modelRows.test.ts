import assert from "node:assert/strict";
import { test } from "node:test";
import type { ProviderInfo } from "../src/adapters/providers/catalog.ts";
import { modelRows, type ListState } from "../src/ui/dialogs/model/modelRows.ts";

const provider = (name: string, extra: Partial<ProviderInfo> = {}): ProviderInfo => ({ name, label: name, methods: ["key"], adapter: "openai", env: [], ...extra });
const providers = [provider("anthropic"), provider("openai"), provider("ollama", { local: true }), provider("groq")];
const lists: Record<string, ListState> = {
  anthropic: { status: "ok", models: ["claude-opus-5", "claude-sonnet-5"] },
  openai: { status: "loading" },
  ollama: { status: "error", error: "connection refused" },
};
const configured = (name: string) => name !== "groq";
const rows = (query: string) => modelRows({ query, providers, lists, configured });
const labels = (query: string) => rows(query).map((r) => `${r.provider} ${r.label}`);

test("lists models, a loading row, and a login row; a local server that's down is left out", () => {
  assert.deepEqual(labels(""), [
    "anthropic claude-opus-5",
    "anthropic claude-sonnet-5",
    "openai loading…",
    "groq Log in to see models…",
  ]);
  assert.deepEqual(rows("").at(-1)!.action, { type: "login", provider: "groq" });
});

test("every word of the query must match, case-insensitively", () => {
  assert.deepEqual(labels("ANTHROPIC opus"), ["anthropic claude-opus-5"]);
  assert.deepEqual(labels("login"), ["groq Log in to see models…"]);
  assert.deepEqual(labels("nothing"), []);
});

test("a typed provider:model that isn't listed comes first; a listed one isn't repeated", () => {
  assert.deepEqual(rows("openai:gpt-9")[0], { provider: "openai", label: 'use "gpt-9"', action: { type: "model", spec: "openai:gpt-9" } });
  assert.deepEqual(labels("anthropic:claude-opus-5"), ["anthropic claude-opus-5"]);
});
