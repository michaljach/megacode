import OpenAI from "openai";
import type { Message, Provider, StopReason, ToolCall, TurnRequest, TurnResult } from "../types.ts";

// Chat Completions adapter: works for OpenAI and any OpenAI-compatible endpoint
// (OpenRouter, Ollama, Groq, DeepSeek, LM Studio, vLLM, ...).
export class OpenAIProvider implements Provider {
  client: OpenAI;
  filter?: (id: string) => boolean;

  constructor(opts: { apiKey?: string; baseURL?: string; filter?: (id: string) => boolean } = {}) {
    this.client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL });
    this.filter = opts.filter;
  }

  async listModels(): Promise<string[]> {
    const models: OpenAI.Model[] = [];
    // No retries: an offline local server should just drop out of the picker quickly.
    for await (const m of this.client.models.list({ maxRetries: 0, timeout: 10_000 })) models.push(m);
    return models
      .sort((a, b) => (b.created ?? 0) - (a.created ?? 0) || a.id.localeCompare(b.id))
      .map((m) => m.id)
      .filter((id) => !this.filter || this.filter(id));
  }

  async turn(req: TurnRequest): Promise<TurnResult> {
    const stream = await this.client.chat.completions.create(
      {
        model: req.model,
        stream: true,
        stream_options: { include_usage: true },
        messages: [{ role: "system", content: req.system }, ...toOpenAI(req.messages)],
        tools: req.tools.map((t) => ({
          type: "function" as const,
          function: { name: t.name, description: t.description, parameters: t.parameters },
        })),
      },
      { signal: req.signal },
    );

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

    const toolCalls: ToolCall[] = calls.filter(Boolean).map((c, i) => ({
      id: c.id || `call_${Date.now()}_${i}`, // some compatible servers omit ids
      name: c.name,
      input: parseArgs(c.args),
    }));
    return { message: { role: "assistant", text, toolCalls }, stop: mapStop(finish, toolCalls.length > 0), usage };
  }
}

function parseArgs(s: string): Record<string, unknown> {
  try {
    return s ? JSON.parse(s) : {};
  } catch {
    return { _invalid_json: s };
  }
}

function mapStop(r: string | null, hasTools: boolean): StopReason {
  if (r === "length") return "max_tokens";
  if (r === "content_filter") return "refusal";
  if (hasTools || r === "tool_calls") return "tool_use";
  return r === "stop" ? "end" : "other";
}

function toOpenAI(messages: Message[]): OpenAI.ChatCompletionMessageParam[] {
  return messages.flatMap((m): OpenAI.ChatCompletionMessageParam[] => {
    if (m.role === "user") return [{ role: "user", content: m.text }];
    if (m.role === "tool")
      return m.results.map((r) => ({ role: "tool", tool_call_id: r.id, content: r.output }));
    return [
      {
        role: "assistant",
        content: m.text || null,
        ...(m.toolCalls.length && {
          tool_calls: m.toolCalls.map((c) => ({
            id: c.id,
            type: "function" as const,
            function: { name: c.name, arguments: JSON.stringify(c.input) },
          })),
        }),
      },
    ];
  });
}
