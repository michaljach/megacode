import assert from "node:assert/strict";
import { test } from "node:test";
import { stripVTControlCharacters as plain } from "node:util";
import type { AgentEvents } from "../src/core/agent.ts";
import type { PermissionMode } from "../src/core/settings.ts";
import { AgentSession, type SessionAgent, type SessionHost } from "../src/ui/session.ts";
import type { Item } from "../src/ui/transcript/ItemView.tsx";

type Send = (text: string, signal: AbortSignal, ev: AgentEvents) => Promise<void>;

/** Resolves on the next tick, after pending promise callbacks have run. */
const tick = () => new Promise((resolve) => setImmediate(resolve));

/** A turn that runs until it's aborted, like a long model response. */
const untilAborted = (signal: AbortSignal) =>
  new Promise<void>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));

/** User messages in the transcript, in order. */
const userTexts = (items: Item[]) =>
  items.filter((i): i is Extract<Item, { kind: "user" }> => i.kind === "user").map((i) => i.text);

/** Notices in the transcript as "level: text", mirroring the old host recorder. */
const noticeTexts = (items: Item[]) =>
  items.filter((i): i is Extract<Item, { kind: "notice" }> => i.kind === "notice").map((i) => `${i.level}: ${i.text}`);

function setup(send: Send, overrides: Partial<SessionHost> = {}) {
  const sent: string[] = [];
  const restored: string[] = [];
  let mode: PermissionMode = "ask";
  let allowEdits = 0;
  const agent: SessionAgent = {
    model: "anthropic:test",
    send: (text, signal, ev) => (sent.push(text), send(text, signal, ev)),
  } as SessionAgent;
  const host: SessionHost = {
    canSend: () => true,
    mode: () => mode,
    setMode: (m) => (mode = m),
    onAllowEdits: () => ((allowEdits++), (mode = "accept-edits")),
    restoreInput: (text) => restored.push(text),
    ...overrides,
  };
  const session = new AgentSession(agent, host);
  return { session, sent, restored, allowEdits: () => allowEdits };
}

test("messages sent during a turn are queued, then sent together", async () => {
  let finish!: () => void;
  const { session, sent } = setup(async (text) => {
    if (text === "first") await new Promise<void>((resolve) => (finish = resolve));
  });
  const done = session.submit("first");
  assert.equal(session.state.running, true);
  await session.submit("second");
  await session.submit("third");
  assert.deepEqual(session.state.queued, ["second", "third"]);
  finish();
  await done;
  assert.deepEqual(sent, ["first", "second\nthird"]);
  assert.deepEqual(userTexts(session.items), ["first", "second\nthird"]);
  assert.equal(session.state.running, false);
  assert.deepEqual(session.state.queued, []);
  assert.equal(session.state.completedTurns, 2);
});

test("an interrupt hands queued messages back instead of sending them", async () => {
  const { session, sent, restored } = setup((_, signal) => untilAborted(signal));
  const done = session.submit("first");
  await session.submit("queued");
  session.interrupt();
  await done;
  assert.deepEqual(sent, ["first"]);
  assert.deepEqual(restored, ["queued"]);
  assert.deepEqual(noticeTexts(session.items), ["warn: Interrupted. What should megacode do instead?"]);
  assert.equal(session.state.completedTurns, 0);
});

test("flushing the queue interrupts the turn and sends the queue right away", async () => {
  const { session, sent, restored } = setup((text, signal) => (text === "first" ? untilAborted(signal) : Promise.resolve()));
  const done = session.submit("first");
  session.flushQueue("now");
  await done;
  assert.deepEqual(sent, ["first", "now"]);
  assert.deepEqual(restored, []);
  assert.deepEqual(noticeTexts(session.items), ["info: Interrupted to send queued messages."]);
});

test("sending one queued message interrupts the turn, runs it, then sends the rest", async () => {
  const { session, sent, restored } = setup((text, signal) => (text === "first" ? untilAborted(signal) : Promise.resolve()));
  const done = session.submit("first");
  await session.submit("one");
  await session.submit("two");
  await session.submit("three");
  session.sendQueued(1);
  await done;
  assert.deepEqual(sent, ["first", "two", "one\nthree"]);
  assert.deepEqual(restored, []);
  assert.deepEqual(noticeTexts(session.items), ["info: Interrupted to send a queued message."]);
  assert.deepEqual(session.state.queued, []);
});

test("sending a queued message that doesn't exist leaves the turn running", async () => {
  const { session } = setup((_, signal) => untilAborted(signal));
  const done = session.submit("first");
  await session.submit("one");
  session.sendQueued(1);
  assert.equal(session.state.running, true);
  session.interrupt();
  await done;
});

test("flushing an empty queue leaves the turn running", async () => {
  const { session } = setup((_, signal) => untilAborted(signal));
  const done = session.submit("first");
  session.flushQueue();
  assert.equal(session.state.running, true);
  session.interrupt();
  await done;
});

test("held-back messages never start a turn", async () => {
  const { session, sent } = setup(async () => {}, { canSend: () => false });
  await session.submit("hello");
  assert.deepEqual(sent, []);
  assert.deepEqual(session.items, [{ kind: "banner" }]);
  assert.equal(session.state.running, false);
});

test("approvals: yes, always for a tool, and auto-approval by mode", async () => {
  const answers: boolean[] = [];
  const { session } = setup(async (_, __, ev) => {
    for (let i = 0; i < 3; i++) answers.push(await ev.approve({ tool: "bash", title: "Bash", body: "ls" }));
    answers.push(await ev.approve({ tool: "write_file", title: "Write" }));
  });
  const done = session.submit("go");
  await tick();
  assert.equal(session.state.approval?.tool, "bash");
  session.answerApproval("yes");
  await tick();
  session.answerApproval("always");
  await tick(); // the third bash call no longer asks
  assert.equal(session.state.approval?.tool, "write_file");
  session.answerApproval("yes");
  await done;
  assert.deepEqual(answers, [true, true, true, true]);
});

test("'always' on an edit switches the session to accept-edits", async () => {
  const { session, allowEdits } = setup(async (_, __, ev) => {
    await ev.approve({ tool: "edit_file", title: "Edit" });
    await ev.approve({ tool: "write_file", title: "Write" }); // auto-approved by the new mode
  });
  const done = session.submit("go");
  await tick();
  session.answerApproval("always");
  await done;
  assert.equal(allowEdits(), 1);
  assert.equal(session.state.approval, null);
});

test("denying stops the turn and says so", async () => {
  let approved: boolean | undefined;
  const { session } = setup(async (_, signal, ev) => {
    approved = await ev.approve({ tool: "bash", title: "Bash", body: "rm -rf build" });
    signal.throwIfAborted();
  });
  const done = session.submit("go");
  await tick();
  session.answerApproval("no");
  await done;
  assert.equal(approved, false);
  assert.deepEqual(noticeTexts(session.items), ["warn: Denied. Tell megacode what to do instead."]);
});

test("an interrupt during an approval denies it", async () => {
  let approved: boolean | undefined;
  const { session } = setup(async (_, signal, ev) => {
    approved = await ev.approve({ tool: "bash", title: "Bash" });
    signal.throwIfAborted();
  });
  const done = session.submit("go");
  await tick();
  session.interrupt();
  await done;
  assert.equal(approved, false);
  assert.equal(session.state.approval, null);
});

test("an interrupt cancels an open questionnaire without answers", async () => {
  let answers: unknown = "unset";
  const { session } = setup(async (_, signal, ev) => {
    answers = await ev.askQuestions!([{ question: "Which?" }], signal);
    signal.throwIfAborted();
  });
  const done = session.submit("go");
  await tick();
  assert.equal(session.state.questionnaire?.questions[0]?.question, "Which?");
  session.interrupt();
  await done;
  assert.equal(answers, null);
  assert.equal(session.state.questionnaire, null);
});

test("rejected credentials point to /login; other errors are shown as they are", async () => {
  const unauthorized = setup(async () => {
    throw Object.assign(new Error("401"), { status: 401 });
  });
  await unauthorized.session.submit("go");
  assert.deepEqual(noticeTexts(unauthorized.session.items), ["error: Anthropic rejected the credentials. Run /login to update them."]);

  const broken = setup(async () => {
    throw new Error("socket hang up");
  });
  await broken.session.submit("go");
  assert.deepEqual(noticeTexts(broken.session.items), ["error: socket hang up"]);
});

test("tool results are added to the transcript with their diff and a summary", async () => {
  const { session } = setup(async (_, __, ev) => {
    const call = { id: "1", name: "edit_file", input: { path: "a.ts" } };
    ev.onToolStart(call);
    assert.equal(session.state.activeTool, call);
    ev.onToolEnd(call, { output: "Edited", isError: false, change: { file: "a.ts", before: "a\n", after: "b\n" } });
  });
  await session.submit("go");
  const tool = session.items.find((i) => i.kind === "tool");
  assert.ok(tool?.kind === "tool" && tool.diff);
  assert.equal(plain(tool.output), "Added 1 line, removed 1 line"); // counts are bold when color is on
  assert.deepEqual(tool.diff.rows.map((r) => r.type), ["remove", "add"]);
  assert.equal(session.state.activeTool, null);
});

test("subscribers hear about every state change", async () => {
  const { session } = setup(async () => {});
  const seen: boolean[] = [];
  const unsubscribe = session.subscribe(() => seen.push(session.state.running));
  await session.submit("go");
  assert.equal(seen[0], true);
  assert.equal(seen.at(-1), false);
  const count = seen.length;
  unsubscribe();
  await session.submit("again");
  assert.equal(seen.length, count);
});
