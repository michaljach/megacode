import { GoogleGenAI, FinishReason, ThinkingLevel, type Content, type Part } from "@google/genai";
import type { Message, ToolCall } from "../../core/conversation.ts";
import { explicitEffort, type Effort, type Provider, type StopReason, type TurnRequest, type TurnResult } from "../../core/provider.ts";
import { fallbackCallId, mergeTurns } from "./shared.ts";

export class GeminiProvider implements Provider {
  client: GoogleGenAI;
  filter: (id: string) => boolean;

  // Without a key the SDK reads $GEMINI_API_KEY / $GOOGLE_API_KEY.
  constructor(apiKey?: string, filter: (id: string) => boolean = () => true) {
    this.client = new GoogleGenAI(apiKey ? { apiKey } : {});
    this.filter = filter;
  }

  async listModels(): Promise<string[]> {
    const ids: string[] = [];
    for await (const m of await this.client.models.list())
      if (m.name && m.supportedActions?.includes("generateContent")) ids.push(m.name.replace(/^models\//, ""));
    return ids.filter(this.filter).reverse(); // newest first
  }

  async turn(req: TurnRequest): Promise<TurnResult> {
    const thinkingConfig = thinkingFor(req.model, explicitEffort(req.effort));
    const stream = await this.client.models.generateContentStream({
      model: req.model,
      contents: toGemini(req.messages),
      config: {
        abortSignal: req.signal,
        ...(thinkingConfig ? { thinkingConfig } : {}),
        systemInstruction: req.system,
        tools: [{ functionDeclarations: req.tools.map(({ parameters, ...tool }) => ({ ...tool, parametersJsonSchema: parameters })) }],
      },
    });

    let text = "";
    let finish: FinishReason | undefined;
    let usage: TurnResult["usage"];
    const parts: Part[] = [];
    const toolCalls: ToolCall[] = [];

    for await (const chunk of stream) {
      const cand = chunk.candidates?.[0];
      const u = chunk.usageMetadata;
      if (u) usage = { input: u.promptTokenCount ?? 0, output: u.candidatesTokenCount ?? 0 };
      if (cand?.finishReason) finish = cand.finishReason;
      for (const part of cand?.content?.parts ?? []) {
        parts.push(part); // keep everything (incl. thought signatures) for replay
        if (part.thought) continue;
        if (part.text) {
          text += part.text;
          req.onText(part.text);
        }
        const call = part.functionCall;
        if (call?.name) toolCalls.push({ id: call.id ?? fallbackCallId(toolCalls.length), name: call.name, input: call.args ?? {} });
      }
    }

    return {
      message: { role: "assistant", text, toolCalls, raw: { provider: "gemini", content: parts } },
      stop: mapStop(finish, toolCalls.length > 0),
      usage,
    };
  }
}

/** Gemini 3 takes a thinking level; earlier models take a token budget. */
function thinkingFor(model: string, effort: Exclude<Effort, "default"> | undefined) {
  if (!effort) return undefined;
  return model.startsWith("gemini-3")
    ? { thinkingLevel: { low: ThinkingLevel.LOW, medium: ThinkingLevel.MEDIUM, high: ThinkingLevel.HIGH }[effort] }
    : { thinkingBudget: { low: 1024, medium: 8192, high: 24576 }[effort] };
}

function mapStop(r: FinishReason | undefined, hasTools: boolean): StopReason {
  if (r === FinishReason.MAX_TOKENS) return "max_tokens";
  if (hasTools) return "tool_use";
  if (r === FinishReason.STOP) return "end";
  if (r === FinishReason.SAFETY || r === FinishReason.PROHIBITED_CONTENT || r === FinishReason.BLOCKLIST) return "refusal";
  return "other";
}

function toTurn(m: Message): ["user" | "model", Part[]] {
  if (m.role === "user") return ["user", [{ text: m.text }]];
  if (m.role === "tool")
    return ["user", m.results.flatMap((r): Part[] => [
      { functionResponse: { id: r.id, name: r.name, response: r.isError ? { error: r.output } : { output: r.output } } },
      ...(r.images ?? []).map((image) => ({ inlineData: { mimeType: image.mediaType, data: image.data } })),
    ])];
  if (m.raw?.provider === "gemini") return ["model", m.raw.content as Part[]];
  return ["model", [
    ...(m.text ? [{ text: m.text }] : []),
    ...m.toolCalls.map((c) => ({ functionCall: { id: c.id, name: c.name, args: c.input } })),
  ]];
}

export const toGemini = (messages: Message[]): Content[] => mergeTurns(messages.map(toTurn)).map(([role, parts]) => ({ role, parts }));
