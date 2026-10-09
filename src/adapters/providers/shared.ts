import type { ImageContent } from "../../core/conversation.ts";
import { ContextOverflowError, isHttpErrorLike, type Provider } from "../../core/provider.ts";

/** How the APIs word "too long": OpenAI, OpenRouter, DeepSeek and vLLM, Responses, Anthropic, Gemini, Groq. */
const TOO_LONG = /context length|context window|prompt is too long|exceeds the maximum (number of tokens|size)|reduce the length/i;

/** Whether an error message says the request is too long for the model. */
export const saysTooLong = (message: string) => TOO_LONG.test(message);

/** Streamed tool arguments → object. Invalid JSON is kept so the tool layer can report it to the model. */
export function parseToolArguments(json: string | undefined): Record<string, unknown> {
  try {
    return json ? JSON.parse(json) : {};
  } catch {
    return { _invalid_json: json };
  }
}

/** Some providers and compatible servers omit tool call ids; every call needs one to pair with its result. */
export const fallbackCallId = (index: number) => `call_${Date.now()}_${index}`;

export const imageDataUrl = (image: ImageContent) => `data:${image.mediaType};base64,${image.data}`;

/** A request rejected (400 or 413) for being too long for the model, as ContextOverflowError; other errors unchanged. */
export function asContextOverflow(error: unknown): unknown {
  if (!isHttpErrorLike(error) || (error.status !== 400 && error.status !== 413)) return error;
  const code = "code" in error ? error.code : undefined;
  const message = "message" in error && typeof error.message === "string" ? error.message : "";
  return code === "context_length_exceeded" || saysTooLong(message) ? new ContextOverflowError(message, { cause: error }) : error;
}

/** `provider` with its API's "too long" errors thrown as ContextOverflowError, and a context window of null on failure. */
export const withOverflowErrors = (provider: Provider): Provider => ({
  turn: (req) =>
    provider.turn(req).catch((e: unknown) => {
      throw asContextOverflow(e);
    }),
  listModels: () => provider.listModels(),
  contextWindow: async (model) => (await provider.contextWindow?.(model).catch(() => null)) ?? null,
});

/** Compressed tool description for embedding in the system prompt. Saves ~50% vs full JSON schema while keeping
 * name, description, arg names, types and defaults. The full schema is still sent via the tools parameter. */
export function compressedToolText(tool: { name: string; description: string; parameters: Record<string, unknown> }): string {
  const p = tool.parameters;
  const props = p.properties ?? {};
  const required = Array.isArray(p.required) ? (p.required as string[]) : [];
  const lines: string[] = [`Tool: ${tool.name}\n${tool.description}`];

  if (typeof p === "object" && props && Object.keys(props).length > 0) {
    lines.push("Args:");
    for (const [k, v] of Object.entries(props)) {
      const prop = v as Record<string, unknown>;
      const req = required.includes(k) ? " *" : "";
      const type = prop.type ?? "object";
      const desc = typeof prop.description === "string" ? prop.description : "";
      const def = prop.default;
      const min = prop.minimum;
      const max = prop.maximum;
      const parts = [`  ${k}${req}`];
      if (type !== "object") parts.push(`(${type})`);
      if (desc) parts.push(desc);
      if (min !== undefined) parts.push(`[min:${min}]`);
      if (max !== undefined) parts.push(`[max:${max}]`);
      if (def !== undefined) parts.push(`[def:${def}]`);
      lines.push(parts.join(" "));
    }
  }

  return lines.join("\n");
}

/**
 * [role, blocks] turns with consecutive same-role turns merged (e.g. an interrupted tool result followed by new user
 * text) and empty ones dropped (e.g. an empty reply). Anthropic and Gemini reject both.
 */
export function mergeTurns<Role, Block>(turns: [Role, Block[]][]): [Role, Block[]][] {
  const merged: [Role, Block[]][] = [];
  for (const [role, blocks] of turns) {
    const last = merged.at(-1);
    if (!blocks.length) continue;
    if (last?.[0] === role) last[1].push(...blocks);
    else merged.push([role, [...blocks]]);
  }
  return merged;
}
