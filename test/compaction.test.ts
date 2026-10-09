import assert from "node:assert/strict";
import { test } from "node:test";
import { Agent, type AgentEvents } from "../src/core/agent.ts";
import { compactHistory, compactionTranscript } from "../src/core/compaction.ts";
import type { Message } from "../src/core/conversation.ts";
import { COMPACT_SYSTEM } from "../src/core/prompts.ts";
import { ContextOverflowError, type Provider, type TurnRequest, type TurnResult } from "../src/core/provider.ts";
import type { ToolSource } from "../src/core/tools.ts";

type Step = Partial<TurnResult> | Error;

/** Plays back responses (or throws the scripted errors) and records each request; summaries get their own script. */
function scripted(steps: Step[], { contextWindow = null as number | null, summaries = ["SUMMARY"] as Step[] } = {}) {
  const requests: TurnRequest[] = [];
  const provider: Provider = {
    listModels: async () => ["fake"],
    contextWindow: async () => contextWindow,
    async turn(req) {
      requests.push({ ...req, messages: [...req.messages] });
      const next = (req.system === COMPACT_SYSTEM ? summaries : steps).shift() ?? {};
      if (next instanceof Error) throw next;
      const text = req.system === COMPACT_SYSTEM ? "SUMMARY" : "";
      return { stop: "end", usage: { input: 1, output: 2 }, ...next, message: { role: "assistant", text, toolCalls: [], ...next.message } };
    },
  };
  return { provider, requests };
}

const tools: ToolSource = {
  specs: () => [],
  has: () => true,
  execute: async () => ({ output: "x".repeat(100), isError: false }),
};

function agentWith(provider: Provider) {
  return new Agent("fake:model", {
    resolveModel: () => ({ provider, model: "model" }),
    tools,
    systemPrompt: async () => "SYSTEM",
    settings: () => ({ maxSteps: 5 }),
  });
}

function recorder() {
  const notices: string[] = [];
  const events: AgentEvents = {
    approve: async () => true,
    onText: () => {},
    onStepEnd: () => {},
    onToolStart: () => {},
    onToolEnd: () => {},
    onNotice: (text) => notices.push(text),
  };
  return { notices, events };
}

const summaries = (requests: TurnRequest[]) => requests.filter((r) => r.system === COMPACT_SYSTEM);
const roles = (messages: Message[]) => messages.map((m) => m.role).join(",");
const toolCall = { id: "1", name: "bash", input: { command: "ls" } };

test("the transcript keeps the first message and the latest ones within budget, noting what it left out", () => {
  const messages: Message[] = [
    { role: "user", text: "original task" },
    ...Array.from({ length: 20 }, (_, i): Message => ({ role: "assistant", text: `reply ${i} ${"y".repeat(50)}`, toolCalls: [] })),
  ];
  const transcript = compactionTranscript(messages, 400);
  assert.ok(transcript.startsWith("[user]\noriginal task"));
  assert.match(transcript, /\[\d+ earlier messages omitted\]/);
  assert.ok(transcript.endsWith(`reply 19 ${"y".repeat(50)}`));
  assert.ok(transcript.length < 500);
  assert.doesNotMatch(compactionTranscript(messages, 100_000), /omitted/);
});

test("the transcript shows tool calls and results, clipping long output in the middle", () => {
  const transcript = compactionTranscript([
    { role: "user", text: "go" },
    { role: "assistant", text: "", toolCalls: [toolCall] },
    { role: "tool", results: [{ id: "1", name: "bash", output: `start${"z".repeat(10_000)}end`, isError: true }] },
  ], 100_000);
  assert.match(transcript, /\[assistant called bash\] \{"command":"ls"\}/);
  assert.match(transcript, /\[bash error\]\nstart/);
  assert.match(transcript, /end$/);
  assert.ok(transcript.length < 3_000);
});

test("a compacted history is one user message with the summary; mid-turn it says to carry on", async () => {
  const { provider } = scripted([]);
  const history: Message[] = [{ role: "user", text: "hi" }];
  const options = { model: "m", messages: history, contextWindow: null, signal: new AbortController().signal };
  const fresh = await compactHistory(provider, { ...options, continuing: false });
  assert.ok(fresh.messages.length >= 1);
  assert.equal(fresh.messages[0].role, "user");
  assert.match((fresh.messages[0] as { text: string }).text, /compacted[\s\S]*SUMMARY$/);
  const midTurn = await compactHistory(provider, { ...options, continuing: true });
  assert.equal(midTurn.messages[0].role, "user");
  assert.match((midTurn.messages[0] as { text: string }).text, /SUMMARY\n\nContinue the work/);
});

test("when even the transcript is too long, compaction retries with half as much, then gives up", async () => {
  const overflow = () => new ContextOverflowError("too long");
  const options = { model: "m", messages: [{ role: "user", text: "x".repeat(5_000) }] as Message[], contextWindow: 1_000, continuing: false, signal: new AbortController().signal };
  const retried = scripted([], { summaries: [overflow(), {}] });
  await compactHistory(retried.provider, options);
  const [first, second] = retried.requests.map((r) => (r.messages[0] as { text: string }).text.length);
  assert.ok(second! < first!);
  const hopeless = scripted([], { summaries: [overflow(), overflow(), overflow()] });
  await assert.rejects(compactHistory(hopeless.provider, options), ContextOverflowError);
  assert.equal(hopeless.requests.length, 3);
});

test("near the context limit, the history is compacted before the next message, which stays verbatim", async () => {
  const { provider, requests } = scripted([{ usage: { input: 790, output: 20 } }, {}], { contextWindow: 1_000 });
  const agent = agentWith(provider);
  const { notices, events } = recorder();
  await agent.send("first", new AbortController().signal, events);
  await agent.send("second", new AbortController().signal, events);
  assert.equal(summaries(requests).length, 1);
  const last = requests.at(-1)!;
  assert.match(roles(last.messages), /^user,user/);
  assert.match((last.messages[0] as { text: string }).text, /SUMMARY$/);
  assert.deepEqual(last.messages.at(-1)!, { role: "user", text: "second" });
});

test("a long turn is compacted between steps and carries on", async () => {
  const { provider, requests } = scripted(
    [{ stop: "tool_use", usage: { input: 900, output: 10 }, message: { role: "assistant", text: "", toolCalls: [toolCall] } }, {}],
    { contextWindow: 1_000 },
  );
  await agentWith(provider).send("task", new AbortController().signal, recorder().events);
  assert.equal(summaries(requests).length, 1);
  const last = requests.at(-1)!;
  assert.match(roles(last.messages), /^user/);
});

test("without a known window, an overflow error compacts the history and retries the request", async () => {
  const { provider, requests } = scripted([{}, new ContextOverflowError("prompt is too long"), {}]);
  const agent = agentWith(provider);
  const { events } = recorder();
  await agent.send("first", new AbortController().signal, events);
  await agent.send("second", new AbortController().signal, events);
  assert.equal(summaries(requests).length, 1);
  assert.match(roles(requests.at(-1)!.messages), /^user/);
  assert.equal(roles(agent.messages).split(",").slice(-2).join(","), "user,assistant");
});

test("an overflow that compacting doesn't fix ends the turn with an actionable error", async () => {
  const { provider } = scripted([new ContextOverflowError("too long"), new ContextOverflowError("too long")]);
  await assert.rejects(agentWith(provider).send("hi", new AbortController().signal, recorder().events), /after compacting\. Run \/clear/);
});

test("histories under the limit, and models whose window is unknown, aren't compacted proactively", async () => {
  const small = scripted([{ usage: { input: 100, output: 10 } }, {}], { contextWindow: 1_000 });
  const unknown = scripted([{ usage: { input: 1e9, output: 10 } }, {}]);
  for (const { provider, requests } of [small, unknown]) {
    const agent = agentWith(provider);
    await agent.send("a", new AbortController().signal, recorder().events);
    await agent.send("b", new AbortController().signal, recorder().events);
    assert.equal(summaries(requests).length, 0);
  }
});
