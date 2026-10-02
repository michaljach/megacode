import assert from "node:assert/strict";
import test from "node:test";
import { formatChatGPTUsage, providerUsage } from "./providers/usage.ts";

test("ChatGPT reports actual windows, plan and credits without inventing missing usage", () => {
  const lines = formatChatGPTUsage({
    plan_type: "plus",
    rate_limit: { primary_window: { used_percent: 25, limit_window_seconds: 18000, reset_after_seconds: 120 } },
    credits: { balance: "3.5" },
  });
  assert.deepEqual(lines, ["Plan: plus", "Usage (5-hour window): 25% used · 75% remaining · resets in 2 min", "Credits remaining: 3.5"]);
  assert.deepEqual(formatChatGPTUsage({ rate_limit: { primary_window: {} } }), []);
  assert.deepEqual(formatChatGPTUsage(null), []);
});

test("OpenRouter fetches fresh key usage and propagates HTTP errors safely", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls++;
    assert.equal(url, "https://example.test/api/v1/key");
    assert.deepEqual(init.headers, { Authorization: "Bearer secret" });
    assert.ok(init.signal);
    return calls > 2 ? new Response("secret server error", { status: 401 }) : Response.json({ data: { usage: 0, limit: 10, limit_remaining: 10 } });
  });
  const creds = { source: "env" as const, apiKey: "secret", baseURL: "https://example.test/api/v1/" };
  const result = await providerUsage("openrouter", creds);
  assert.match(result, /Used \(total\): \$0/);
  assert.match(result, /Key spending limit: \$10/);
  await providerUsage("openrouter", creds);
  assert.equal(calls, 2);
  await assert.rejects(providerUsage("openrouter", creds), /HTTP 401.*Run \/login/);
});

test("unsupported and unconfigured providers do not make speculative API calls", async (t) => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected request"); });
  assert.match(await providerUsage("openai", { source: "env", apiKey: "key" }), /not available/);
  assert.match(await providerUsage("ollama", { source: "local" }), /no account quota API/);
  assert.match(await providerUsage("gemini", {}), /Not configured/);
});

test("DeepSeek reports balance without presenting it as usage", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ balance_infos: [{ currency: "USD", total_balance: "12.34" }] }));
  const result = await providerUsage("deepseek", { source: "saved", apiKey: "key", baseURL: "https://example.test" });
  assert.match(result, /Balance remaining: 12.34 USD/);
  assert.match(result, /Usage totals and limits are not exposed/);
});
