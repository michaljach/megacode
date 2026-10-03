import Anthropic from "@anthropic-ai/sdk";
import type { Message, ToolCall } from "../../core/conversation.ts";
import { explicitEffort, type Provider, type StopReason, type TurnRequest, type TurnResult } from "../../core/provider.ts";

/** Output cap when the model's own limit is unknown, and the most we ask for even when it's higher. */
const MAX_OUTPUT = 64_000;

export class AnthropicProvider implements Provider {
  client: Anthropic;
  /** Model limits and capabilities from the Models API, fetched once per model. Null if unavailable. */
  private models = new Map<string, Promise<Anthropic.ModelInfo | null>>();

  // Without a key the SDK falls back to $ANTHROPIC_API_KEY or an `ant auth login` profile.
  constructor(apiKey?: string) {
    this.client = new Anthropic(apiKey ? { apiKey } : {});
  }

  private modelInfo(model: string): Promise<Anthropic.ModelInfo | null> {
    let info = this.models.get(model);
    if (!info) {
      // Without the lookup (e.g. a proxy that lacks the endpoint) fall back to the defaults.
      info = this.client.models.retrieve(model).catch(() => null);
      this.models.set(model, info);
    }
    return info;
  }

  async listModels(): Promise<string[]> {
    const ids: string[] = [];
    for await (const m of this.client.models.list()) ids.push(m.id);
    return ids;
  }

  async turn(req: TurnRequest): Promise<TurnResult> {
    const info = await this.modelInfo(req.model);
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
    return {
      message: { role: "assistant", text, toolCalls, raw: { provider: "anthropic", content: msg.content } },
      stop: mapStop(msg.stop_reason),
      responseModel: msg.model,
      usage: {
        input: msg.usage.input_tokens + (msg.usage.cache_read_input_tokens ?? 0) + (msg.usage.cache_creation_input_tokens ?? 0),
        output: msg.usage.output_tokens,
        inputBreakdown: {
          uncached: msg.usage.input_tokens,
          cacheRead: msg.usage.cache_read_input_tokens ?? 0,
          cacheCreation: msg.usage.cache_creation_input_tokens ?? 0,
        },
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

export function toAnthropic(messages: Message[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  const push = (role: "user" | "assistant", blocks: Anthropic.ContentBlockParam[]) => {
    if (!blocks.length) return; // the API rejects empty turns, e.g. an empty reply
    const last = out.at(-1);
    // Merge consecutive same-role turns (e.g. an interrupted tool result followed by new user text).
    if (last && last.role === role && Array.isArray(last.content)) last.content.push(...blocks);
    else out.push({ role, content: [...blocks] });
  };
  for (const m of messages) {
    if (m.role === "user") push("user", [{ type: "text", text: m.text }]);
    else if (m.role === "tool")
      push(
        "user",
        m.results.map((r) => ({ type: "tool_result", tool_use_id: r.id, content: r.images?.length
          ? [{ type: "text", text: r.output }, ...r.images.map((image) => ({ type: "image" as const, source: { type: "base64" as const, media_type: image.mediaType, data: image.data } }))]
          : r.output, is_error: r.isError })),
      );
    else if (m.raw?.provider === "anthropic") push("assistant", m.raw.content as Anthropic.ContentBlockParam[]);
    else {
      const blocks: Anthropic.ContentBlockParam[] = [];
      if (m.text) blocks.push({ type: "text", text: m.text });
      for (const c of m.toolCalls) blocks.push({ type: "tool_use", id: c.id, name: c.name, input: c.input });
      push("assistant", blocks);
    }
  }
  return out;
}
