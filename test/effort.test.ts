import assert from "node:assert/strict";
import { test } from "node:test";
import { AnthropicProvider } from "../src/adapters/providers/anthropic.ts";
import { GeminiProvider } from "../src/adapters/providers/gemini.ts";
import OpenAI from "openai";
import { OpenAIProvider } from "../src/adapters/providers/openai.ts";
import { EFFORTS, type TurnRequest } from "../src/core/provider.ts";

const request: TurnRequest = {
  model: "test", system: "test", messages: [], tools: [],
  signal: new AbortController().signal, onText() {},
};

for (const effort of [undefined, ...EFFORTS]) {
  const explicit = effort && effort !== "default" ? effort : undefined;
  test(`provider effort mapping: ${effort ?? "unset"}`, async () => {
    const openai = new OpenAIProvider({ apiKey: "test" });
    let openaiParams: any;
    openai.client.chat.completions.create = (async (params: unknown) => {
      openaiParams = params;
      return (async function* () {})();
    }) as any;
    await openai.turn({ ...request, effort });
    assert.equal(openaiParams.reasoning_effort, explicit);
    if (!explicit) assert.ok(!("reasoning_effort" in openaiParams));

    const anthropic = new AnthropicProvider("test");
    anthropic.client.models.retrieve = (async () => null) as any; // limits unknown: defaults apply
    let anthropicParams: any;
    anthropic.client.messages.stream = ((params: unknown) => {
      anthropicParams = params;
      return { on() {}, async finalMessage() {
        return { content: [], stop_reason: "end_turn", usage: { input_tokens: 0, output_tokens: 0 } };
      } };
    }) as any;
    await anthropic.turn({ ...request, effort });
    assert.deepEqual(anthropicParams.output_config, explicit ? { effort: explicit } : undefined);

    const gemini = new GeminiProvider("test");
    let geminiParams: any;
    gemini.client.models.generateContentStream = (async (params: unknown) => {
      geminiParams = params;
      return (async function* () {})();
    }) as any;
    await gemini.turn({ ...request, model: "gemini-3-flash-preview", effort });
    assert.deepEqual(geminiParams.config.thinkingConfig, explicit ? { thinkingLevel: explicit.toUpperCase() } : undefined);
    await gemini.turn({ ...request, model: "gemini-2.5-pro", effort });
    assert.deepEqual(geminiParams.config.thinkingConfig, explicit
      ? { thinkingBudget: { low: 1024, medium: 8192, high: 24576 }[explicit] } : undefined);
  });
}

const capabilities = (supported: boolean) => ({
  effort: { supported, low: { supported }, medium: { supported }, high: { supported }, max: { supported }, xhigh: null },
});

/** An Anthropic provider whose model lookup returns `info`; records the request params. */
function anthropicWith(info: unknown) {
  const provider = new AnthropicProvider("test");
  const params: any[] = [];
  provider.client.models.retrieve = (async () => info) as any;
  provider.client.messages.stream = ((p: unknown) => {
    params.push(p);
    return { on() {}, async finalMessage() {
      return { content: [], stop_reason: "end_turn", usage: { input_tokens: 0, output_tokens: 0 } };
    } };
  }) as any;
  return { provider, params };
}

test("Anthropic: max_tokens follows the model's output limit, up to 64000", async () => {
  for (const [limit, expected] of [[8192, 8192], [128_000, 64_000], [null, 64_000]] as const) {
    const { provider, params } = anthropicWith(limit === null ? null : { max_tokens: limit, capabilities: null });
    await provider.turn(request);
    assert.equal(params[0].max_tokens, expected);
  }
});

test("Anthropic: effort is only sent to models that support it", async () => {
  const cases = [[capabilities(true), { effort: "high" }], [capabilities(false), undefined], [null, { effort: "high" }]] as const;
  for (const [caps, expected] of cases) {
    const { provider, params } = anthropicWith({ max_tokens: 64_000, capabilities: caps });
    await provider.turn({ ...request, effort: "high" });
    assert.deepEqual(params[0].output_config, expected);
  }
});

test("Anthropic: model limits are looked up once per model", async () => {
  const { provider } = anthropicWith(null);
  let lookups = 0;
  provider.client.models.retrieve = (async () => (lookups++, null)) as any;
  await provider.turn(request);
  await provider.turn(request);
  await provider.turn({ ...request, model: "other" });
  assert.equal(lookups, 2);
});

const badRequest = (error: Record<string, unknown>) => new OpenAI.BadRequestError(400, error, undefined, new Headers());

test("Chat Completions: a model that rejects reasoning_effort is retried and remembered", async () => {
  const rejections = [
    // OpenAI names the parameter; some compatible servers only mention it in the message.
    { message: "Unsupported parameter: 'reasoning_effort' is not supported with this model.", param: "reasoning_effort", code: "unsupported_parameter" },
    { message: "Extra inputs are not permitted: reasoning_effort" },
  ];
  for (const rejection of rejections) {
    const openai = new OpenAIProvider({ apiKey: "test" });
    const sent: unknown[] = [];
    openai.client.chat.completions.create = (async (params: any) => {
      sent.push(params.reasoning_effort);
      if (params.reasoning_effort) throw badRequest(rejection);
      return (async function* () {})();
    }) as any;
    await openai.turn({ ...request, effort: "high" });
    await openai.turn({ ...request, effort: "high" });
    assert.deepEqual(sent, ["high", undefined, undefined]);
  }
});

test("Chat Completions: other bad requests are not retried", async () => {
  const openai = new OpenAIProvider({ apiKey: "test" });
  let calls = 0;
  openai.client.chat.completions.create = (async () => {
    calls++;
    throw badRequest({ message: "bad messages", param: "messages" });
  }) as any;
  await assert.rejects(openai.turn({ ...request, effort: "high" }), /bad messages/);
  assert.equal(calls, 1);
});
