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
