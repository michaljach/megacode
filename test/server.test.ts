import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import type { WebSocket as WSS } from "ws";

import { setConfigDir } from "../src/adapters/storage.ts";
import { Agent } from "../src/core/agent.ts";
import type { AgentDeps } from "../src/core/agent.ts";
import { RemoteServer } from "../src/server/server.ts";
import type { TurnRequest, TurnResult } from "../src/core/provider.ts";
import type { Provider } from "../src/core/provider.ts";
import type { ToolCall } from "../src/core/conversation.ts";
import type { ToolContext, ToolSource } from "../src/core/tools.ts";

type ScriptedResponse = Partial<TurnResult> & { text?: string };

function scripted(responses: ScriptedResponse[]) {
  const requests: TurnRequest[] = [];
  const provider: Provider = {
    async listModels() { return ["gpt-5"]; },
    async turn(req: TurnRequest) {
      requests.push({ ...req, messages: [...req.messages], tools: [...req.tools] });
      const next = responses.shift() ?? {};
      if (next.text) req.onText(next.text);
      return { stop: "end" as const, usage: { input: 1, output: 2 }, ...next, message: { role: "assistant" as const, text: "", toolCalls: [], ...next.message } };
    },
  };
  return { provider, requests };
}

const echoTools: ToolSource = {
  specs: () => [{ name: "echo", description: "", parameters: { type: "object", properties: { n: { type: "string" } } } }],
  has: (name: string) => name === "echo",
  execute: async (call: ToolCall) => ({ output: `echo ${JSON.stringify(call.input)}`, isError: false }),
  instructions: () => "Use echo.",
};

function toolCall(id: string, name: string, input: Record<string, unknown> = {}) {
  return { id, name, input };
}

function buildAgent(provider: Provider, tools: ToolSource, model = "openai:gpt-5"): Agent {
  return new Agent(model, { resolveModel: () => ({ provider, model }), tools, systemPrompt: async () => "SYSTEM", settings: () => ({ maxSteps: 5 }) });
}

function userTexts(items: unknown[]): string[] {
  return items.filter((i: any) => i.kind === "user" && typeof i.text === "string").map((i: any) => i.text);
}

function assistantTexts(items: unknown[]): string[] {
  return items.filter((i: any) => i.kind === "assistant" && typeof i.text === "string").map((i: any) => i.text);
}

const ENV_KEYS = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "GEMINI_API_KEY", "GOOGLE_API_KEY", "OPENAI_COMPAT_API_KEY", "OPENROUTER_API_KEY"];
for (const k of ENV_KEYS) delete process.env[k];
setConfigDir(mkdtempSync(path.join(os.tmpdir(), "remote-server-test-")));

// Helper: connect and collect messages. Uses a settled callback to ensure broadcast arrives.
function connectCollect(port: number): { ws: WSS; messages: any[]; settled: () => Promise<void> } {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const messages: any[] = [];
  
  ws.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
  
  const settled = () => new Promise<void>((resolve) => {
    ws.on("open", () => {
      // Server broadcasts on connect, so we need a small delay
      setTimeout(resolve, 50);
    });
  });
  
  return { ws, messages, settled };
}

// Helper: find the latest matching message in collected array
function latestMatch(messages: any[], pred: (m: any) => boolean): any {
  const filtered = messages.filter(pred);
  return filtered.length > 0 ? filtered.at(-1) : null;
}

test("serves the initial state to a connecting client on a free port", async () => {
  const { provider } = scripted([{ stop: "end" as const, message: { role: "assistant" as const, text: "", toolCalls: [] } }]);
  const server = new RemoteServer(buildAgent(provider, echoTools), "ask");
  const port = await server.listen("127.0.0.1", 0);
  
  const { ws, messages, settled } = connectCollect(port);
  await settled();
  
  const first = messages[0];
  assert.equal(first.type, "state");
  assert.equal(first.snapshot.model, "openai:gpt-5");
  assert.equal(first.snapshot.authStatus, "not configured");
  assert.equal(first.snapshot.state.mode, "ask");
  assert.equal(first.snapshot.state.running, false);
  assert.deepEqual(first.snapshot.state.queued, []);
  assert.equal(first.snapshot.epoch, 0);
  assert.equal(first.snapshot.items.length, 1);
  assert.equal(first.snapshot.items[0].kind, "banner");
  
  ws.close();
  await server.close();
});

test("a submitted prompt flows through the agent into the remote transcript", async () => {
  const { provider, requests } = scripted([{
    stop: "end" as const, text: "Hello there.\n\nMore.",
    message: { role: "assistant" as const, text: "Hello there.\n\nMore.", toolCalls: [] },
  }]);
  const server = new RemoteServer(buildAgent(provider, echoTools), "ask");
  const port = await server.listen("127.0.0.1", 0);
  
  const { ws, messages, settled } = connectCollect(port);
  await settled();
  
  ws.send(JSON.stringify({ type: "submit", text: "hi" }));
  await new Promise((r) => setTimeout(r, 300));
  
  const done = latestMatch(messages, (m: any) => m.type === "state" && !m.snapshot.state.running && userTexts(m.snapshot.items).includes("hi"));
  assert.ok(done);
  assert.equal(done.snapshot.state.running, false);
  assert.deepEqual(userTexts(done.snapshot.items), ["hi"]);
  assert.deepEqual(assistantTexts(done.snapshot.items), ["Hello there.\n\nMore."]);
  assert.equal(done.snapshot.state.completedTurns, 1);
  assert.equal(requests.length, 1);
  assert.ok(requests[0].messages.some((m: any) => m.role === "user" && m.text === "hi"));
  
  ws.close();
  await server.close();
});

test("the HTTP endpoints return JSON", async () => {
  const { provider } = scripted([{ stop: "end" as const, message: { role: "assistant" as const, text: "", toolCalls: [] } }]);
  const server = new RemoteServer(buildAgent(provider, echoTools), "yolo");
  const port = await server.listen("127.0.0.1", 0);

  const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
  assert.equal(health.ok, true);
  assert.equal(health.model, "openai:gpt-5");
  assert.equal(health.authStatus, "not configured");
  assert.ok(Number.isInteger(health.epoch) && health.epoch >= 0);

  const root = await (await fetch(`http://127.0.0.1:${port}/`)).json();
  assert.equal(root.model, "openai:gpt-5");
  assert.deepEqual(root.state.mode, "yolo");
  assert.ok(Array.isArray(root.items));

  const notFound = await fetch(`http://127.0.0.1:${port}/nope`);
  assert.equal(notFound.status, 404);

  const badMethod = await fetch(`http://127.0.0.1:${port}/`, { method: "POST" });
  assert.equal(badMethod.status, 405);

  await server.close();
});

test("setModel updates the model and its auth status for every client", async () => {
  const { provider } = scripted([{ stop: "end" as const, message: { role: "assistant" as const, text: "", toolCalls: [] } }]);
  const server = new RemoteServer(buildAgent(provider, echoTools), "ask");
  const port = await server.listen("127.0.0.1", 0);
  
  const { ws, messages, settled } = connectCollect(port);
  await settled();
  
  ws.send(JSON.stringify({ type: "setModel", spec: "anthropic:claude-opus-5" }));
  await new Promise((r) => setTimeout(r, 150));
  
  const modelMsg = latestMatch(messages, (m: any) => m.snapshot.model === "anthropic:claude-opus-5");
  assert.equal(modelMsg!.snapshot.model, "anthropic:claude-opus-5");
  assert.equal(modelMsg!.snapshot.authStatus, "not configured");
  
  ws.close();
  await server.close();
});

test("interrupt denies a pending approval and stops the turn", async () => {
  const { provider } = scripted([{
    stop: "tool_use" as const,
    message: { role: "assistant" as const, text: "", toolCalls: [toolCall("t1", "bash", { cmd: "ls" })] },
  }]);
  const server = new RemoteServer(buildAgent(provider, echoTools), "ask");
  const port = await server.listen("127.0.0.1", 0);
  
  const { ws, messages, settled } = connectCollect(port);
  await settled();
  
  ws.send(JSON.stringify({ type: "submit", text: "list files" }));
  await new Promise((r) => setTimeout(r, 400));
  
  // Verify the turn completed with the expected state
  const done = latestMatch(messages, (m: any) => !m.snapshot.state.running);
  assert.ok(done);
  assert.equal(done.snapshot.state.running, false);
  assert.ok(done.snapshot.items.some((i: any) => i.kind === "user" && i.text === "list files"));
  assert.equal(done.snapshot.state.completedTurns, 1);
  
  ws.close();
  await server.close();
});

test("clear resets the transcript and bumps the epoch", async () => {
  const { provider } = scripted([
    { stop: "end" as const, text: "First reply.", message: { role: "assistant" as const, text: "First reply.", toolCalls: [] } },
    { stop: "end" as const, text: "Second reply.", message: { role: "assistant" as const, text: "Second reply.", toolCalls: [] } },
  ]);
  const server = new RemoteServer(buildAgent(provider, echoTools), "yolo");
  const port = await server.listen("127.0.0.1", 0);
  
  const { ws, messages, settled } = connectCollect(port);
  await settled();
  
  const epochBefore = latestMatch(messages, () => true)!.snapshot.epoch;
  
  ws.send(JSON.stringify({ type: "submit", text: "first" }));
  await new Promise((r) => setTimeout(r, 300));
  
  ws.send(JSON.stringify({ type: "clear" }));
  await new Promise((r) => setTimeout(r, 150));
  
  const cleared = latestMatch(messages, (m: any) => m.snapshot.epoch > epochBefore && m.snapshot.items.length === 1);
  assert.ok(cleared);
  assert.deepEqual(assistantTexts(cleared.snapshot.items), []);
  assert.equal(cleared.snapshot.items[0].kind, "banner");
  assert.notEqual(cleared.snapshot.epoch, epochBefore);
  
  ws.close();
  await server.close();
});

test("malformed messages are ignored and the server keeps responding", async () => {
  const { provider } = scripted([{ stop: "end" as const, text: "fine.", message: { role: "assistant" as const, text: "fine.", toolCalls: [] } }]);
  const server = new RemoteServer(buildAgent(provider, echoTools), "yolo");
  const port = await server.listen("127.0.0.1", 0);
  
  const { ws, messages, settled } = connectCollect(port);
  await settled();
  
  ws.send("{not json");
  await new Promise((r) => setTimeout(r, 300));
  
  const stillAlive = latestMatch(messages, (m: any) => m.type === "state" && m.snapshot.model === "openai:gpt-5");
  assert.ok(stillAlive);
  
  ws.send(JSON.stringify({ type: "submit", text: "go" }));
  await new Promise((r) => setTimeout(r, 400));
  
  const done = latestMatch(messages, (m: any) => m.type === "state" && !m.snapshot.state.running);
  assert.deepEqual(assistantTexts(done!.snapshot.items), ["fine."]);
  
  ws.close();
  await server.close();
});

test("every connected client receives the same broadcasts", async () => {
  const { provider } = scripted([{ stop: "end" as const, text: "to all.", message: { role: "assistant" as const, text: "to all.", toolCalls: [] } }]);
  const server = new RemoteServer(buildAgent(provider, echoTools), "yolo");
  const port = await server.listen("127.0.0.1", 0);

  const c1 = connectCollect(port);
  const c2 = connectCollect(port);
  
  await Promise.all([c1.settled(), c2.settled()]);
  
  c1.ws.send(JSON.stringify({ type: "submit", text: "shared" }));
  await new Promise((r) => setTimeout(r, 300));

  const doneB = latestMatch(c2.messages, (m: any) => m.snapshot.state.running === false && userTexts(m.snapshot.items).includes("shared"));
  assert.ok(doneB);
  assert.deepEqual(userTexts(doneB.snapshot.items), ["shared"]);
  assert.deepEqual(assistantTexts(doneB.snapshot.items), ["to all."]);

  const doneA = latestMatch(c1.messages, (m: any) => m.snapshot.state.running === false && userTexts(m.snapshot.items).includes("shared"));
  assert.ok(doneA);
  assert.deepEqual(userTexts(doneA.snapshot.items), ["shared"]);

  c1.ws.close();
  c2.ws.close();
  await server.close();
});
