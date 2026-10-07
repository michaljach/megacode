import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { loadSession, newSessionId, resumeCommand, saveSession } from "../src/adapters/sessions.ts";
import { configDir, setConfigDir } from "../src/adapters/storage.ts";
import { Agent } from "../src/core/agent.ts";
import type { Message } from "../src/core/conversation.ts";
import { itemsFromMessages } from "../src/ui/transcript/fromMessages.ts";

const call = { id: "c1", name: "bash", input: { command: "npm test" } };
const conversation: Message[] = [
  { role: "user", text: "run the tests" },
  {
    role: "assistant",
    text: "Running them.",
    toolCalls: [call],
    raw: { provider: "anthropic", content: [{ type: "thinking", signature: "sig" }] },
  },
  { role: "tool", results: [{ id: "c1", name: "bash", output: "1 failing", isError: true }] },
  { role: "assistant", text: "One test fails.", toolCalls: [] },
];

function tempConfig(t: { after(fn: () => void): void }) {
  const previous = configDir();
  const dir = mkdtempSync(path.join(os.tmpdir(), "sessions-test-"));
  setConfigDir(dir);
  t.after(() => {
    setConfigDir(previous);
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

test("a saved session loads back whole, provider-native content included, readable only by you", async (t) => {
  const dir = tempConfig(t);
  const id = newSessionId();
  await saveSession({ id, cwd: "/work", model: "anthropic:claude-opus-5", messages: conversation });
  const { updated, ...loaded } = (await loadSession(id))!;
  assert.deepEqual(loaded, { id, cwd: "/work", model: "anthropic:claude-opus-5", messages: conversation });
  assert.match(updated, /^\d{4}-\d\d-\d\dT/);
  assert.equal(statSync(path.join(dir, "sessions", `${id}.json`)).mode & 0o777, 0o600);
});

test("unknown ids and anything that isn't an id load nothing", async (t) => {
  tempConfig(t);
  assert.equal(await loadSession(newSessionId()), null);
  assert.equal(await loadSession("../auth"), null);
  assert.equal(await loadSession(""), null);
});

test("the resume command names the worktree when the session ran in a kept one", () => {
  assert.equal(resumeCommand("abc"), "megacode --resume abc");
  assert.equal(resumeCommand("abc", "fix-auth"), "megacode -w fix-auth --resume abc");
});

test("restoring a session cut off mid-turn gives its open tool calls interrupted results", () => {
  const agent = new Agent("fake:model", {
    resolveModel: () => ({ provider: { turn: async () => ({}) as never, listModels: async () => [] }, model: "model" }),
    tools: { specs: () => [], has: () => false, execute: async () => ({ output: "", isError: false }) },
    systemPrompt: async () => "",
    settings: () => ({ maxSteps: 1 }),
  });
  agent.restore(conversation.slice(0, 2));
  assert.equal(agent.messages.length, 3);
  const interrupted = { id: "c1", name: "bash", output: "Interrupted by user.", isError: true };
  assert.deepEqual(agent.messages[2], { role: "tool", results: [interrupted] });
});

test("a resumed conversation is shown again: messages, replies, and tool calls with their results", () => {
  assert.deepEqual(itemsFromMessages(conversation), [
    { kind: "user", text: "run the tests" },
    { kind: "assistant", text: "Running them.", first: true },
    { kind: "tool", call, output: "1 failing", isError: true },
    { kind: "assistant", text: "One test fails.", first: true },
  ]);
});
