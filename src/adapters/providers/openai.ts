import OpenAI from "openai";
import type { Message, ToolCall } from "../../core/conversation.ts";
import { explicitEffort, type Provider, type StopReason, type TurnRequest, type TurnResult } from "../../core/provider.ts";
import { fallbackCallId, imageDataUrl, parseToolArguments } from "./shared.ts";

// Chat Completions adapter: works for OpenAI and any OpenAI-compatible endpoint
// (OpenRouter, Ollama, Groq, DeepSeek, LM Studio, vLLM, ...).
export class OpenAIProvider implements Provider {
  filter: (id: string) => boolean;
  /** Models that rejected reasoning_effort; it isn't sent to them again this session. */
  #noEffort = new Set<string>();
  readonly #options: { apiKey?: string; baseURL?: string };
  #client?: OpenAI;
  #windows?: Promise<Map<string, number>>;

  constructor(opts: { apiKey?: string; baseURL?: string; filter?: (id: string) => boolean } = {}) {
    this.#options = { apiKey: opts.apiKey, baseURL: opts.baseURL };
    this.filter = opts.filter ?? (() => true);
  }

  /** Created on first use: the SDK throws without a key, and a model can be picked before logging in. */
  get client(): OpenAI {
    return (this.#client ??= new OpenAI(this.#options));
  }

  async listModels(): Promise<string[]> {
    const models = await this.#fetchModels();
    return models
      .sort((a, b) => (b.created ?? 0) - (a.created ?? 0) || a.id.localeCompare(b.id))
      .map((m) => m.id)
      .filter(this.filter);
  }

  /** From the model list, when the server includes it there (OpenRouter, vLLM); plain OpenAI doesn't. Fetched once. */
  async contextWindow(model: string): Promise<number | null> {
    this.#windows ??= this.#fetchModels().then(
      (models) => new Map(models.flatMap((m) => [[m.id, reportedWindow(m)] as const]).filter((e): e is [string, number] => e[1] !== null)),
      () => new Map(),
    );
    return (await this.#windows).get(model) ?? null;
  }

  async #fetchModels(): Promise<OpenAI.Model[]> {
    const models: OpenAI.Model[] = [];
    // No retries: an offline local server should just drop out of the picker quickly.
    for await (const m of this.client.models.list({ maxRetries: 0, timeout: 10_000 })) models.push(m);
    return models;
  }

  #stream(req: TurnRequest, effort: ReturnType<typeof explicitEffort>) {
    return this.client.chat.completions.create(
      {
        model: req.model,
        ...(effort ? { reasoning_effort: effort } : {}),
        stream: true,
        stream_options: { include_usage: true },
        messages: [{ role: "system", content: req.system }, ...toOpenAI(req.messages)],
        tools: req.tools.map((tool) => ({ type: "function" as const, function: tool })),
      },
      { signal: req.signal },
    );
  }

  async turn(req: TurnRequest): Promise<TurnResult> {
    const effort = this.#noEffort.has(req.model) ? undefined : explicitEffort(req.effort);
    let stream;
    try {
      stream = await this.#stream(req, effort);
    } catch (e) {
      // Models without reasoning (and some compatible servers) reject the parameter instead of ignoring it.
      if (!effort || !rejectsEffort(e)) throw e;
      this.#noEffort.add(req.model);
      stream = await this.#stream(req, undefined);
    }

    let text = "";
    let finish: string | null = null;
    let usage: TurnResult["usage"];
    const calls: { id: string; name: string; args: string }[] = [];

    for await (const chunk of stream) {
      if (chunk.usage) usage = { input: chunk.usage.prompt_tokens, output: chunk.usage.completion_tokens };
      const choice = chunk.choices[0];
      if (!choice) continue;
      if (choice.delta.content) {
        text += choice.delta.content;
        req.onText(choice.delta.content);
      }
      for (const tc of choice.delta.tool_calls ?? []) {
        const c = (calls[tc.index] ??= { id: "", name: "", args: "" });
        if (tc.id) c.id = tc.id;
        if (tc.function?.name) c.name += tc.function.name;
        if (tc.function?.arguments) c.args += tc.function.arguments;
      }
      if (choice.finish_reason) finish = choice.finish_reason;
    }

    const toolCalls: ToolCall[] = calls
      .filter(Boolean)
      .map((c, i) => ({ id: c.id || fallbackCallId(i), name: c.name, input: parseToolArguments(c.args) }));
    return { message: { role: "assistant", text, toolCalls }, stop: mapStop(finish, toolCalls.length > 0), usage };
  }
}

/** OpenRouter's context_length or vLLM's max_model_len, extra fields of a listed model. */
function reportedWindow(m: object): number | null {
  const value: unknown = Reflect.get(m, "context_length") ?? Reflect.get(m, "max_model_len");
  return typeof value === "number" ? value : null;
}

const rejectsEffort = (e: unknown) =>
  e instanceof OpenAI.BadRequestError && (e.param === "reasoning_effort" || /reasoning_effort/.test(e.message));

function mapStop(r: string | null, hasTools: boolean): StopReason {
  if (r === "length") return "max_tokens";
  if (r === "content_filter") return "refusal";
  if (hasTools || r === "tool_calls") return "tool_use";
  return r === "stop" ? "end" : "other";
}

export function toOpenAI(messages: Message[]): OpenAI.ChatCompletionMessageParam[] {
  return messages.flatMap((m): OpenAI.ChatCompletionMessageParam[] => {
    if (m.role === "user") return [{ role: "user", content: m.text }];
    if (m.role === "tool") {
      const results: OpenAI.ChatCompletionMessageParam[] = m.results.map((r) => ({ role: "tool", tool_call_id: r.id, content: r.output }));
      // Chat Completions only accepts images in user messages, after all tool replies.
      for (const r of m.results) {
        if (r.images?.length) results.push({ role: "user", content: [
          { type: "text", text: r.output },
          ...r.images.map((image) => ({ type: "image_url" as const, image_url: { url: imageDataUrl(image) } })),
        ] });
      }
      return results;
    }
    // An assistant message needs content or tool calls; leave out empty replies.
    if (!m.text && !m.toolCalls.length) return [];
    const toolCalls = m.toolCalls.map((c) => ({
      id: c.id,
      type: "function" as const,
      function: { name: c.name, arguments: JSON.stringify(c.input) },
    }));
    return [{ role: "assistant", content: m.text || null, ...(toolCalls.length && { tool_calls: toolCalls }) }];
  });
}
