import assert from "node:assert/strict";
import { test } from "node:test";
import { AnthropicProvider } from "../src/providers/anthropic.ts";
import { GeminiProvider } from "../src/providers/gemini.ts";
import { OpenAIProvider } from "../src/providers/openai.ts";
import { EFFORTS, type TurnRequest } from "../src/types.ts";

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
