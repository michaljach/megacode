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

test("speed and context use come from the last response, and clear resets them", async () => {
  const usages = [{ input: 100, output: 50 }, undefined];
  const { agent, events } = setup(async () => ({ stop: "end", usage: usages.shift(), message: { role: "assistant", text: "ok", toolCalls: [] } }));
  assert.equal(agent.speed, null);
  assert.equal(agent.context, null);

  await agent.send("go", new AbortController().signal, events);
  assert.ok(agent.speed! > 0 && Number.isFinite(agent.speed), String(agent.speed));
  assert.deepEqual(agent.context, { tokens: 150, window: null }, "the test provider reports no window");

  await agent.send("again", new AbortController().signal, events);
  assert.equal(agent.speed, null, "a response without usage has no speed");
  assert.equal(agent.context, null);

  usages.push({ input: 10, output: 5 });
  await agent.send("once more", new AbortController().signal, events);
  agent.clear();
  assert.equal(agent.speed, null);
  assert.equal(agent.context, null);
});
