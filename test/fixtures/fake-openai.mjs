// A scriptable OpenAI-compatible Chat Completions server for end-to-end tests.
import { createServer } from "node:http";

/**
 * `respond(body, index)` returns what the "model" does for the index-th chat request:
 *   { text }                       a plain reply
 *   { toolCalls: [{ name, args }] } tool calls (args is an object)
 *   { status, error }              an HTTP error with an OpenAI-style error body
 * A reply may add `usage: { prompt_tokens, completion_tokens }`. `contextLength` is reported in the model list, as
 * OpenRouter does. Every request body is recorded in `requests`.
 */
export async function startFakeOpenAI(respond, { contextLength } = {}) {
  const requests = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d)).on("end", () => {
      if (req.url.endsWith("/models"))
        return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ object: "list", data: [{ id: "fake", object: "model", created: 0, context_length: contextLength }] }));
      const body = JSON.parse(raw);
      requests.push(body);
      const step = respond(body, requests.length - 1);
      if (step.status) {
        res.writeHead(step.status, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: step.error }));
      }
      const chunk = (delta, finish_reason = null) => ({ id: "x", object: "chat.completion.chunk", created: 0, model: "fake", choices: [{ index: 0, delta, finish_reason }] });
      const chunks = step.toolCalls
        ? [chunk({ tool_calls: step.toolCalls.map((c, index) => ({ index, id: `call_${requests.length}_${index}`, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } })) }, "tool_calls")]
        : [chunk({ content: step.text }, "stop")];
      if (step.usage) {
        const cacheHit = typeof step.usage.prompt_cache_hit_tokens === "number" ? step.usage.prompt_cache_hit_tokens : 0;
        const cacheMiss = typeof step.usage.prompt_cache_miss_tokens === "number" ? step.usage.prompt_cache_miss_tokens : 0;
        chunks.push({
          ...chunk({}),
          choices: [],
          usage: {
            ...step.usage,
            total_tokens: step.usage.prompt_tokens + step.usage.completion_tokens,
            prompt_cache_hit_tokens: cacheHit,
            prompt_cache_miss_tokens: cacheMiss,
          },
        });
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/v1`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** The last message of a request, for "what did the model just get back" checks. */
export const lastMessage = (body) => body.messages.at(-1);
