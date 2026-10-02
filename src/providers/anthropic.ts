import Anthropic from "@anthropic-ai/sdk";
import type { Message, Provider, StopReason, ToolCall, TurnRequest, TurnResult } from "../types.ts";

export class AnthropicProvider implements Provider {
  client: Anthropic;

  // Without a key the SDK falls back to $ANTHROPIC_API_KEY or an `ant auth login` profile.
  constructor(apiKey?: string) {
    this.client = new Anthropic(apiKey ? { apiKey } : {});
  }

  async listModels(): Promise<string[]> {
    const ids: string[] = [];
    for await (const m of this.client.models.list()) ids.push(m.id);
    return ids;
  }

  async turn(req: TurnRequest): Promise<TurnResult> {
    const stream = this.client.messages.stream(
      {
        model: req.model,
        ...(req.effort && req.effort !== "default" ? { output_config: { effort: req.effort } } : {}),
        max_tokens: 64000,
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
      usage: { input: msg.usage.input_tokens, output: msg.usage.output_tokens },
    };
  }
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

function toAnthropic(messages: Message[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  const push = (role: "user" | "assistant", blocks: Anthropic.ContentBlockParam[]) => {
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
