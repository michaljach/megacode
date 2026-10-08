import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import type { Message, ToolCall } from "../../core/conversation.ts";
import {
  ContextOverflowError,
  explicitEffort,
  isHttpErrorLike,
  type Provider,
  type StopReason,
  type TurnRequest,
  type TurnResult,
} from "../../core/provider.ts";
import { CHATGPT_BASE_URL, chatGPTFetchHeaders, chatGPTHeaders, chatGPTTokens } from "../auth/chatgpt.ts";
import { imageDataUrl, parseToolArguments, saysTooLong } from "./shared.ts";

const FALLBACK_MODELS = ["gpt-5", "gpt-5-codex"];

type ListedModel = { id: string; contextWindow: number | null };

/** OpenAI models through a ChatGPT subscription, via the Responses API. */
export class ChatGPTProvider implements Provider {
  sessionId = randomUUID();
  #models?: Promise<ListedModel[]>;

  async #client(forceRefresh = false) {
    const t = await chatGPTTokens(forceRefresh);
    return new OpenAI({
      apiKey: t.access,
      baseURL: CHATGPT_BASE_URL,
      defaultHeaders: { ...chatGPTHeaders(t), session_id: this.sessionId },
    });
  }

  async listModels(): Promise<string[]> {
    const ids = (await this.#listed()).map((m) => m.id);
    return ids.length ? ids : FALLBACK_MODELS;
  }

  async contextWindow(model: string): Promise<number | null> {
    return (await this.#listed()).find((m) => m.id === model)?.contextWindow ?? null;
  }

  /** The visible models and their context windows, fetched once; empty if the backend doesn't answer. */
  #listed(): Promise<ListedModel[]> {
    return (this.#models ??= this.#fetchModels());
  }

  async #fetchModels(): Promise<ListedModel[]> {
    const t = await chatGPTTokens();
    try {
      const url = `${CHATGPT_BASE_URL}/models?client_version=1.0.0`;
      const res = await fetch(url, { headers: chatGPTFetchHeaders(t), signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(String(res.status));
      type Listed = { slug?: string; id?: string; visibility?: string; context_window?: number };
      const body = (await res.json()) as { models?: Listed[] };
      return (body.models ?? []).flatMap((m) => {
        const id = m.slug ?? m.id;
        return m.visibility === "hide" || !id ? [] : [{ id, contextWindow: m.context_window ?? null }];
      });
    } catch {
      return [];
    }
  }

  async turn(req: TurnRequest): Promise<TurnResult> {
    const params: OpenAI.Responses.ResponseCreateParamsStreaming = {
      model: req.model,
      instructions: req.system,
      input: toResponses(req.messages),
      tools: req.tools.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: t.parameters, strict: false })),
      tool_choice: "auto",
      parallel_tool_calls: true,
      reasoning: { effort: explicitEffort(req.effort) ?? "medium", summary: "auto" },
      store: false,
      stream: true,
      include: ["reasoning.encrypted_content"],
      prompt_cache_key: this.sessionId,
    };
    let stream;
    try {
      stream = await (await this.#client()).responses.create(params, { signal: req.signal });
    } catch (e) {
      if (!isHttpErrorLike(e) || e.status !== 401) throw e;
      stream = await (await this.#client(true)).responses.create(params, { signal: req.signal }); // token revoked early
    }

    let text = "";
    let stop: StopReason = "end";
    let usage: TurnResult["usage"];
    const items: OpenAI.Responses.ResponseOutputItem[] = [];
    const toolCalls: ToolCall[] = [];

    for await (const ev of stream) {
      switch (ev.type) {
        case "response.output_text.delta":
          text += ev.delta;
          req.onText(ev.delta);
          break;
        case "response.output_item.done":
          items.push(ev.item);
          if (ev.item.type === "function_call")
            toolCalls.push({ id: ev.item.call_id, name: ev.item.name, input: parseToolArguments(ev.item.arguments) });
          break;
        case "response.completed":
        case "response.incomplete": {
          const u = ev.response.usage;
          if (u) usage = { input: u.input_tokens, output: u.output_tokens };
          if (ev.type === "response.incomplete")
            stop = ev.response.incomplete_details?.reason === "content_filter" ? "refusal" : "max_tokens";
          break;
        }
        case "response.failed": {
          const message = ev.response.error?.message ?? "Response failed";
          throw saysTooLong(message) ? new ContextOverflowError(message) : new Error(message);
        }
        case "error":
          throw new Error(ev.message);
      }
    }
    if (stop === "end" && toolCalls.length) stop = "tool_use";
    return { message: { role: "assistant", text, toolCalls, raw: { provider: "openai-responses", content: items } }, stop, usage };
  }
}

export function toResponses(messages: Message[]): OpenAI.Responses.ResponseInputItem[] {
  return messages.flatMap((m): OpenAI.Responses.ResponseInputItem[] => {
    if (m.role === "user") return [{ role: "user", content: m.text }];
    if (m.role === "tool") {
      const results: OpenAI.Responses.ResponseInputItem[] = m.results.map((r) => ({ type: "function_call_output", call_id: r.id, output: r.output }));
      // Function outputs are text-only; images follow in a user message.
      for (const r of m.results) {
        if (r.images?.length) results.push({ role: "user", content: [
          { type: "input_text", text: r.output },
          ...r.images.map((image) => ({ type: "input_image" as const, image_url: imageDataUrl(image), detail: "auto" as const })),
        ] });
      }
      return results;
    }
    if (m.raw?.provider === "openai-responses")
      // With store: false the server keeps nothing, so item ids can't be referenced; resend items without them.
      return (m.raw.content as Record<string, unknown>[]).map(({ id: _id, ...item }) => item as unknown as OpenAI.Responses.ResponseInputItem);
    return [
      ...(m.text ? [{ role: "assistant" as const, content: m.text }] : []),
      ...m.toolCalls.map((c) => ({ type: "function_call" as const, call_id: c.id, name: c.name, arguments: JSON.stringify(c.input) })),
    ];
  });
}
