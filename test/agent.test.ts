import assert from "node:assert/strict";
import { test } from "node:test";
import { Agent, type AgentDeps, type AgentEvents } from "../src/core/agent.ts";
import type { Message, ToolCall } from "../src/core/conversation.ts";
import type { Provider, TurnRequest, TurnResult } from "../src/core/provider.ts";
import { canSuggest } from "../src/core/suggestion.ts";
import { combineToolSources, type ToolSource } from "../src/core/tools.ts";

/** A provider that plays back scripted responses and records each request. */
function scripted(responses: Partial<TurnResult>[]) {
  const requests: TurnRequest[] = [];
  const provider: Provider = {
    async listModels() {
      return ["fake"];
    },
    async turn(req) {
      requests.push({ ...req, messages: [...req.messages] });
      const next = responses.shift() ?? {};
      return { stop: "end", usage: { input: 1, output: 2 }, ...next, message: { role: "assistant", text: "", toolCalls: [], ...next.message } };
    },
  };
  return { provider, requests };
}

const echoTools: ToolSource = {
  specs: () => [{ name: "echo", description: "", parameters: { type: "object", properties: {} } }],
  has: (name) => name === "echo",
  execute: async (call) => ({ output: `echo ${JSON.stringify(call.input)}`, isError: false, change: { file: "f", before: "", after: "x" } }),
  instructions: () => "Use echo.",
};

function agentWith(provider: Provider, deps: Partial<AgentDeps> = {}) {
  return new Agent("fake:model", {
    resolveModel: () => ({ provider, model: "model" }),
    tools: echoTools,
    systemPrompt: () => "SYSTEM",
    settings: () => ({ maxSteps: 5 }),
    ...deps,
  });
}

function recorder() {
  const log: string[] = [];
  const events: AgentEvents = {
    approve: async () => true,
    onText: (d) => log.push(`text:${d}`),
    onStepEnd: () => log.push("step"),
    onToolStart: (c) => log.push(`start:${c.name}`),
    onToolEnd: (c, r) => log.push(`end:${c.name}:${r.output}`),
    onNotice: (t, level) => log.push(`${level}:${t}`),
  };
  return { log, events };
}

const call = (id: string): ToolCall => ({ id, name: "echo", input: { n: id } });

test("runs tool calls until the model stops, keeping display-only data out of history", async () => {
  const { provider, requests } = scripted([
    { stop: "tool_use", message: { role: "assistant", text: "", toolCalls: [call("1"), call("2")] } },
    { message: { role: "assistant", text: "Done", toolCalls: [] } },
  ]);
  const agent = agentWith(provider);
  const { log, events } = recorder();
  await agent.send("hi", new AbortController().signal, events);

  assert.deepEqual(log, ["step", "start:echo", 'end:echo:echo {"n":"1"}', "start:echo", 'end:echo:echo {"n":"2"}', "step"]);
  assert.equal(requests.length, 2);
  assert.equal(requests[0]!.system, "SYSTEM\n\nUse echo.");
  assert.deepEqual(requests[0]!.tools.map((t) => t.name), ["echo"]);
  const results = agent.messages[2];
  assert.equal(results?.role, "tool");
  assert.deepEqual(results.results.map((r) => Object.keys(r).sort()), [
    ["id", "images", "isError", "name", "output"],
    ["id", "images", "isError", "name", "output"],
  ]);
  assert.deepEqual(agent.usage, { input: 2, output: 4 });
});

test("refreshes installed skill context between turns", async () => {
  const { provider, requests } = scripted([{}, {}]);
  let context = "No skills";
  const agent = agentWith(provider, { systemPrompt: () => context });
  const { events } = recorder();
  await agent.send("hello", new AbortController().signal, events);
  context = "New skill installed";
  await agent.send("use the skill", new AbortController().signal, events);
  assert.match(requests[0].system, /No skills/);
  assert.match(requests[1].system, /New skill installed/);
});

test("truncated tool calls are not run, and history stays valid", async () => {
  const { provider } = scripted([{ stop: "max_tokens", message: { role: "assistant", text: "", toolCalls: [call("1")] } }]);
  const agent = agentWith(provider);
  const { log, events } = recorder();
  await agent.send("hi", new AbortController().signal, events);
  assert.ok(!log.some((l) => l.startsWith("start:")));
  assert.match(log.at(-1)!, /^warn:Output truncated/);
  const last = agent.messages.at(-1);
  assert.equal(last?.role, "tool");
  assert.equal(last.results[0]!.isError, true);
});

test("stops at the step limit with a notice", async () => {
  const { provider, requests } = scripted(Array(10).fill({ stop: "tool_use", message: { role: "assistant", text: "", toolCalls: [call("x")] } }));
  const agent = agentWith(provider, { settings: () => ({ maxSteps: 3 }) });
  const { log, events } = recorder();
  await agent.send("loop", new AbortController().signal, events);
  assert.equal(requests.length, 3);
  assert.match(log.at(-1)!, /^warn:Stopped after 3 steps/);
});

test("an interrupt mid-tools fills in results for calls that didn't run", async () => {
  const ctrl = new AbortController();
  const { provider } = scripted([{ stop: "tool_use", message: { role: "assistant", text: "", toolCalls: [call("1"), call("2")] } }]);
  const tools: ToolSource = { ...echoTools, execute: async (c) => (ctrl.abort(), echoTools.execute(c, { approve: async () => true })) };
  const agent = agentWith(provider, { tools });
  await assert.rejects(agent.send("hi", ctrl.signal, recorder().events));
  const last = agent.messages.at(-1);
  assert.equal(last?.role, "tool");
  assert.deepEqual(last.results.map((r) => [r.id, r.isError]), [["1", false], ["2", true]]);
});

test("prompt suggestions require a completed assistant response", () => {
  const ineligible: Message[][] = [
    [],
    [{ role: "user", text: "Fix the tests" }],
    [{ role: "assistant", text: "   ", toolCalls: [] }],
    [{ role: "assistant", text: "Checking tests", toolCalls: [call("1")] }],
    [{ role: "tool", results: [] }],
  ];
  for (const messages of ineligible) assert.equal(canSuggest(messages), false);
  assert.equal(canSuggest([{ role: "assistant", text: "Which file?", toolCalls: [] }]), true);
});

test("combined tool sources route calls and report unknown tools", async () => {
  const other: ToolSource = { specs: () => [], has: (n) => n === "other", execute: async () => ({ output: "other", isError: false }) };
  const tools = combineToolSources(echoTools, other);
  const ctx = { approve: async () => true };
  assert.equal((await tools.execute({ id: "1", name: "other", input: {} }, ctx)).output, "other");
  assert.deepEqual(await tools.execute({ id: "1", name: "nope", input: {} }, ctx), { output: "Unknown tool: nope", isError: true });
  assert.equal(tools.instructions?.(), "Use echo.");
});

/** A provider that rejects any request containing an image, like a model without vision. */
function rejectsImages() {
  const requests: TurnRequest[] = [];
  let step = 0;
  const provider: Provider = {
    async listModels() {
      return [];
    },
    async turn(req) {
      requests.push({ ...req, messages: structuredClone(req.messages) });
      if (req.messages.some((m) => m.role === "tool" && m.results.some((r) => r.images?.length)))
        throw Object.assign(new Error("400 The image data you provided does not represent a valid image."), { status: 400 });
      step++;
      const toolCalls = step === 1 ? [{ id: "v1", name: "view", input: {} }] : [];
      return { stop: toolCalls.length ? "tool_use" : "end", message: { role: "assistant", text: step === 1 ? "" : "ok", toolCalls } };
    },
  };
  const tools: ToolSource = {
    specs: () => [],
    has: () => true,
    execute: async () => ({ output: "Image: a.png", isError: false, images: [{ mediaType: "image/png", data: "AAAA" }] }),
  };
  return { provider, tools, requests };
}

test("a rejected image is dropped from history so the session keeps working", async () => {
  const { provider, tools, requests } = rejectsImages();
  const agent = agentWith(provider, { tools });
  const { log, events } = recorder();
  await agent.send("look at a.png", new AbortController().signal, events);
  assert.ok(log.some((l) => /^warn:.*image/i.test(l)), log.join("\n"));
  const result = agent.messages.find((m) => m.role === "tool");
  assert.ok(result?.role === "tool");
  assert.equal(result.results[0]!.images, undefined);
  assert.match(result.results[0]!.output, /^Image: a\.png\n\[.*rejected.*\]$/);

  // Later turns no longer resend the image.
  await agent.send("thanks", new AbortController().signal, events);
  const last = agent.messages.at(-1);
  assert.equal(last?.role === "assistant" && last.text, "ok");
  assert.equal(requests.length, 4); // view, rejected, retry without image, thanks
});

test("other request errors are not retried", async () => {
  let calls = 0;
  const provider: Provider = {
    async listModels() {
      return [];
    },
    async turn() {
      calls++;
      throw Object.assign(new Error("400 bad request"), { status: 400 });
    },
  };
  await assert.rejects(agentWith(provider).send("hi", new AbortController().signal, recorder().events), /bad request/);
  assert.equal(calls, 1);
});
