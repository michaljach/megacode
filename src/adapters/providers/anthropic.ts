import Anthropic from "@anthropic-ai/sdk";
import type { Message, ToolCall } from "../../core/conversation.ts";
import { explicitEffort, type Provider, type StopReason, type TurnRequest, type TurnResult } from "../../core/provider.ts";
import { mergeTurns } from "./shared.ts";

/** Output cap when the model's own limit is unknown, and the most we ask for even when it's higher. */
const MAX_OUTPUT = 64_000;

export class AnthropicProvider implements Provider {
  client: Anthropic;
  /** Model limits and capabilities from the Models API, fetched once per model. Null if unavailable. */
  #models = new Map<string, Promise<Anthropic.ModelInfo | null>>();

  // Without a key the SDK falls back to $ANTHROPIC_API_KEY or an `ant auth login` profile.
  constructor(apiKey?: string) {
    this.client = new Anthropic(apiKey ? { apiKey } : {});
  }

  #modelInfo(model: string): Promise<Anthropic.ModelInfo | null> {
    let info = this.#models.get(model);
    // Without the lookup (e.g. a proxy that lacks the endpoint) fall back to the defaults.
    if (!info) this.#models.set(model, (info = this.client.models.retrieve(model).catch(() => null)));
    return info;
  }

  async contextWindow(model: string): Promise<number | null> {
    return (await this.#modelInfo(model))?.max_input_tokens ?? null;
  }

  async listModels(): Promise<string[]> {
    const ids: string[] = [];
    for await (const m of this.client.models.list()) ids.push(m.id);
    return ids;
  }

  async turn(req: TurnRequest): Promise<TurnResult> {
    const info = await this.#modelInfo(req.model);
    const effort = supportedEffort(explicitEffort(req.effort), info);
    const stream = this.client.messages.stream(
      {
        model: req.model,
        ...(effort ? { output_config: { effort } } : {}),
        // Older models allow fewer output tokens; asking for more is a 400 on every turn.
        max_tokens: Math.min(info?.max_tokens ?? MAX_OUTPUT, MAX_OUTPUT),
        system: req.system,
        cache_control: { type: "ephemeral" },
        tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })),
        messages: toAnthropic(req.messages),
      },
      { signal: req.signal },
    );
    stream.on("text", req.onText);
    const msg = await stream.finalMessage();

    const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const toolCalls: ToolCall[] = msg.content.flatMap((b) =>
      b.type === "tool_use" ? [{ id: b.id, name: b.name, input: b.input as Record<string, unknown> }] : [],
    );
    const uncached = msg.usage.input_tokens;
    const cacheRead = msg.usage.cache_read_input_tokens ?? 0;
    const cacheCreation = msg.usage.cache_creation_input_tokens ?? 0;
    return {
      message: { role: "assistant", text, toolCalls, raw: { provider: "anthropic", content: msg.content } },
      stop: mapStop(msg.stop_reason),
      responseModel: msg.model,
      usage: {
        input: uncached + cacheRead + cacheCreation,
        output: msg.usage.output_tokens,
        inputBreakdown: { uncached, cacheRead, cacheCreation },
      },
    };
  }
}

/** The effort to send, or undefined when the model reports it can't take that level (sending it is a 400). */
function supportedEffort(effort: ReturnType<typeof explicitEffort>, info: Anthropic.ModelInfo | null) {
  const support = info?.capabilities?.effort;
  if (!effort || !support) return effort; // unknown capabilities: send what the user chose
  return support.supported && support[effort].supported ? effort : undefined;
}

function mapStop(r: Anthropic.StopReason | null): StopReason {
  switch (r) {
    case "end_turn":
    case "stop_sequence":
      return "end";
    case "tool_use":
    case "max_tokens":
    case "refusal":
      return r;
    default:
      return "other";
  }
}

function toTurn(m: Message): ["user" | "assistant", Anthropic.ContentBlockParam[]] {
  if (m.role === "user") return ["user", [{ type: "text", text: m.text }]];
  if (m.role === "tool")
    return ["user", m.results.map((r) => ({ type: "tool_result", tool_use_id: r.id, content: r.images?.length
      ? [{ type: "text", text: r.output }, ...r.images.map((image) => ({ type: "image" as const, source: { type: "base64" as const, media_type: image.mediaType, data: image.data } }))]
      : r.output, is_error: r.isError }))];
  if (m.raw?.provider === "anthropic") return ["assistant", m.raw.content as Anthropic.ContentBlockParam[]];
  return ["assistant", [
    ...(m.text ? [{ type: "text" as const, text: m.text }] : []),
    ...m.toolCalls.map((c) => ({ type: "tool_use" as const, id: c.id, name: c.name, input: c.input })),
  ]];
}

export const toAnthropic = (messages: Message[]): Anthropic.MessageParam[] =>
  mergeTurns(messages.map(toTurn)).map(([role, content]) => ({ role, content }));
