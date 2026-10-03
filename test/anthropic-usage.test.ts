import assert from "node:assert/strict";
import { test } from "node:test";
import { AnthropicProvider } from "../src/adapters/providers/anthropic.ts";

for (const cached of [false, true]) test(`Anthropic input usage includes cache components: ${cached}`, async () => {
  const provider = new AnthropicProvider("test");
  provider.client.models.retrieve = (async () => null) as any;
  provider.client.messages.stream = (() => ({
    on() {},
    async finalMessage() {
      return {
        model: "gpt-6-astra", content: [], stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 5,
          ...(cached ? { cache_read_input_tokens: 80, cache_creation_input_tokens: 20 } : {}),
        },
      };
    },
  })) as any;
  const result = await provider.turn({ model: "alias", messages: [], tools: [], system: "",
    signal: new AbortController().signal, onText() {} });
  assert.equal(result.responseModel, "gpt-6-astra");
  assert.deepEqual(result.usage, {
    input: cached ? 110 : 10, output: 5,
    inputBreakdown: { uncached: 10, cacheRead: cached ? 80 : 0, cacheCreation: cached ? 20 : 0 },
  });
});
