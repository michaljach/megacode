import assert from "node:assert/strict";
import { test } from "node:test";
import { Agent } from "./agent.ts";
import type { Message } from "./types.ts";

test("prompt suggestions require a completed assistant response", async () => {
  const histories: Message[][] = [
    [],
    [{ role: "user", text: "Fix the tests" }],
    [{ role: "assistant", text: "   ", toolCalls: [] }],
    [{ role: "assistant", text: "Checking tests", toolCalls: [{ id: "1", name: "bash", input: { command: "npm test" } }] }],
    [{ role: "tool", results: [] }],
  ];
  for (const messages of histories) {
    // No configured provider is needed: ineligible turns must return before resolving one.
    const agent = Object.assign(Object.create(Agent.prototype) as Agent, { messages, model: "invalid" });
    assert.equal(await agent.suggestPrompt(new AbortController().signal), "");
  }
});
