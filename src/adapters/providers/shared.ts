import type { ImageContent } from "../../core/conversation.ts";

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
