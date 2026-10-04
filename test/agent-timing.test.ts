import assert from "node:assert/strict";
import { test } from "node:test";
import { Agent, type AgentEvents, type ModelTiming } from "../src/core/agent.ts";
import type { Provider } from "../src/core/provider.ts";

function setup(turn: Provider["turn"]) {
  const timings: ModelTiming[] = [];
  const text: string[] = [];
  const agent = new Agent("test:model", {
    resolveModel: () => ({ model: "model", provider: { turn, listModels: async () => [] } }),
    tools: { specs: () => [], has: () => true, execute: async () => ({ output: "ok", isError: false }) },
    systemPrompt: async () => "", settings: () => ({ maxSteps: 3, effort: "low" }),
  });
  const events: AgentEvents = {
    approve: async () => true, onText: t => text.push(t), onStepEnd() {},
    onToolStart() {}, onToolEnd() {}, onNotice() {}, onModelTiming: t => timings.push(t),
  };
  return { agent, timings, events, text };
}

test("per-step timing captures tool-only and text responses, usage and effort", async () => {
  let turns = 0;
  const { agent, timings, events, text } = setup(async req => {
    assert.equal(req.effort, "low");
    turns++;
    req.onText("");
    if (turns === 2) req.onText("done");
    return { stop: "end", responseModel: "backend-model", usage: { input: 10, output: 2 }, message: {
      role: "assistant", text: "", toolCalls: turns === 1 ? [{ id: "a", name: "read", input: {} }] : [],
    } };
  });
  await agent.send("go", new AbortController().signal, events);
  assert.deepEqual(timings.map(t => [t.step, t.status]), [[1, "completed"], [2, "completed"]]);
  assert.equal(timings[0]!.firstTextMs, null);
  assert.ok(timings[1]!.firstTextMs !== null);
  for (const t of timings) {
    assert.ok(t.durationMs >= 0);
    if (t.firstTextMs !== null) assert.ok(t.firstTextMs >= 0 && t.firstTextMs <= t.durationMs);
    assert.deepEqual(t.usage, { input: 10, output: 2 });
    assert.equal(t.responseModel, "backend-model");
  }
  assert.deepEqual(text, ["", "", "done"]);
});

for (const abort of [false, true]) test(`timing retains ${abort ? "aborted" : "failed"} requests`, async () => {
  const controller = new AbortController();
  const failure = new Error("failed");
  const { agent, timings, events } = setup(async () => {
    if (abort) controller.abort(failure);
    throw failure;
  });
  await assert.rejects(agent.send("go", controller.signal, events), /failed/);
  assert.equal(timings.length, 1);
  assert.equal(timings[0]!.status, abort ? "aborted" : "error");
  assert.equal(timings[0]!.firstTextMs, null);
  assert.equal(timings[0]!.usage, undefined);
});
