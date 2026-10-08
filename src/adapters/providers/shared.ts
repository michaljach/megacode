import type { ImageContent } from "../../core/conversation.ts";
import { ContextOverflowError, type Provider } from "../../core/provider.ts";

/** Narrow an unknown value to a small HTTP-error-like shape with status, code, and message. */
export const isHttpErrorLike = (error: unknown): error is { status: number; code?: unknown; message: string } =>
  typeof error === "object" && error !== null && "status" in error && "message" in error;

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
  const isHttp = typeof error === "object" && error !== null && "status" in error;
  if (!isHttp) return error;
  const status = (error as { status: number }).status;
  const code = (error as { code?: unknown }).code;
  const message = "message" in error ? (error as { message: string }).message : "";
  if (status !== 400 && status !== 413) return error;
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
