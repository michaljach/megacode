import assert from "node:assert/strict";
import { test } from "node:test";
import { toAnthropic } from "../src/adapters/providers/anthropic.ts";
import { toResponses } from "../src/adapters/providers/chatgpt.ts";
import { toGemini } from "../src/adapters/providers/gemini.ts";
import { toOpenAI } from "../src/adapters/providers/openai.ts";
import type { AssistantMessage, ImageContent, Message } from "../src/core/conversation.ts";

const image: ImageContent = { mediaType: "image/png", data: "AAAA" };

/**
 * A conversation that started on another provider (its native content must be ignored), viewed an
 * image, was interrupted before its second tool ran, and then got a new user message.
 */
const switched: Message[] = [
  { role: "user", text: "look" },
  {
    role: "assistant",
    text: "Checking",
    toolCalls: [
      { id: "c1", name: "view_image", input: { path: "a.png" } },
      { id: "c2", name: "bash", input: { command: "ls" } },
    ],
    raw: { provider: "someone-else", content: [{ opaque: true }] },
  },
  {
    role: "tool",
    results: [
      { id: "c1", name: "view_image", output: "Image: a.png", isError: false, images: [image] },
      { id: "c2", name: "bash", output: "Interrupted by user.", isError: true },
    ],
  },
  { role: "user", text: "next" },
];

/** A reply with nothing in it, e.g. an empty end_turn. Providers reject empty turns in history. */
const empty = (raw?: AssistantMessage["raw"]): Message => ({ role: "assistant", text: "", toolCalls: [], raw });
const aroundEmpty = (raw?: AssistantMessage["raw"]): Message[] => [{ role: "user", text: "a" }, empty(raw), { role: "user", text: "b" }];

test("Anthropic: neutral history, image tool results, and merged user turns", () => {
  assert.deepEqual(toAnthropic(switched), [
    { role: "user", content: [{ type: "text", text: "look" }] },
    {
      role: "assistant",
      content: [
        { type: "text", text: "Checking" },
        { type: "tool_use", id: "c1", name: "view_image", input: { path: "a.png" } },
        { type: "tool_use", id: "c2", name: "bash", input: { command: "ls" } },
      ],
    },
    {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "c1",
          content: [{ type: "text", text: "Image: a.png" }, { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } }],
          is_error: false,
        },
        { type: "tool_result", tool_use_id: "c2", content: "Interrupted by user.", is_error: true },
        // Tool results come first in a user turn; the new message follows in the same turn.
        { type: "text", text: "next" },
      ],
    },
  ]);
});

test("Anthropic: replays its own native content verbatim", () => {
  const native = [{ type: "thinking", thinking: "hmm", signature: "sig" }, { type: "text", text: "Hi" }];
  const out = toAnthropic([{ role: "user", text: "q" }, { role: "assistant", text: "Hi", toolCalls: [], raw: { provider: "anthropic", content: native } }]);
  assert.deepEqual(out[1], { role: "assistant", content: native });
});

test("Anthropic: empty replies are left out of history", () => {
  const expected = [{ role: "user", content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }];
  assert.deepEqual(toAnthropic(aroundEmpty()), expected);
  assert.deepEqual(toAnthropic(aroundEmpty({ provider: "anthropic", content: [] })), expected);
});

test("Gemini: neutral history, image tool results, and merged user turns", () => {
  assert.deepEqual(toGemini(switched), [
    { role: "user", parts: [{ text: "look" }] },
    {
      role: "model",
      parts: [
        { text: "Checking" },
        { functionCall: { id: "c1", name: "view_image", args: { path: "a.png" } } },
        { functionCall: { id: "c2", name: "bash", args: { command: "ls" } } },
      ],
    },
    {
      role: "user",
      parts: [
        { functionResponse: { id: "c1", name: "view_image", response: { output: "Image: a.png" } } },
        { inlineData: { mimeType: "image/png", data: "AAAA" } },
        { functionResponse: { id: "c2", name: "bash", response: { error: "Interrupted by user." } } },
        { text: "next" },
      ],
    },
  ]);
});

test("Gemini: replays its own parts (thought signatures included) and drops empty replies", () => {
  const parts = [{ text: "plan", thought: true }, { text: "Hi", thoughtSignature: "sig" }];
  const out = toGemini([{ role: "user", text: "q" }, { role: "assistant", text: "Hi", toolCalls: [], raw: { provider: "gemini", content: parts } }]);
  assert.deepEqual(out[1], { role: "model", parts });
  const expected = [{ role: "user", parts: [{ text: "a" }, { text: "b" }] }];
  assert.deepEqual(toGemini(aroundEmpty()), expected);
  assert.deepEqual(toGemini(aroundEmpty({ provider: "gemini", content: [] })), expected);
});

test("Chat Completions: tool replies stay contiguous, images follow as a user message", () => {
  assert.deepEqual(toOpenAI(switched), [
    { role: "user", content: "look" },
    {
      role: "assistant",
      content: "Checking",
      tool_calls: [
        { id: "c1", type: "function", function: { name: "view_image", arguments: '{"path":"a.png"}' } },
        { id: "c2", type: "function", function: { name: "bash", arguments: '{"command":"ls"}' } },
      ],
    },
    { role: "tool", tool_call_id: "c1", content: "Image: a.png" },
    { role: "tool", tool_call_id: "c2", content: "Interrupted by user." },
    { role: "user", content: [{ type: "text", text: "Image: a.png" }, { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }] },
    { role: "user", content: "next" },
  ]);
});

test("Chat Completions: tool-only replies have null content, empty replies are left out", () => {
  const out = toOpenAI([{ role: "assistant", text: "", toolCalls: [{ id: "c", name: "bash", input: {} }] }]);
  assert.deepEqual(out, [{ role: "assistant", content: null, tool_calls: [{ id: "c", type: "function", function: { name: "bash", arguments: "{}" } }] }]);
  assert.deepEqual(toOpenAI(aroundEmpty()), [{ role: "user", content: "a" }, { role: "user", content: "b" }]);
});

test("Responses: function calls and outputs, images follow as a user message", () => {
  assert.deepEqual(toResponses(switched), [
    { role: "user", content: "look" },
    { role: "assistant", content: "Checking" },
    { type: "function_call", call_id: "c1", name: "view_image", arguments: '{"path":"a.png"}' },
    { type: "function_call", call_id: "c2", name: "bash", arguments: '{"command":"ls"}' },
    { type: "function_call_output", call_id: "c1", output: "Image: a.png" },
    { type: "function_call_output", call_id: "c2", output: "Interrupted by user." },
    { role: "user", content: [{ type: "input_text", text: "Image: a.png" }, { type: "input_image", image_url: "data:image/png;base64,AAAA", detail: "auto" }] },
    { role: "user", content: "next" },
  ]);
});

test("Responses: replays its own items without server ids (nothing is stored), drops empty replies", () => {
  const items = [
    { id: "rs_1", type: "reasoning", encrypted_content: "x", summary: [] },
    { id: "fc_1", type: "function_call", call_id: "c", name: "bash", arguments: "{}" },
  ];
  const out = toResponses([{ role: "assistant", text: "", toolCalls: [], raw: { provider: "openai-responses", content: items } }]);
  assert.deepEqual(out, [
    { type: "reasoning", encrypted_content: "x", summary: [] },
    { type: "function_call", call_id: "c", name: "bash", arguments: "{}" },
  ]);
  assert.deepEqual(toResponses(aroundEmpty()), [{ role: "user", content: "a" }, { role: "user", content: "b" }]);
});
