// Provider-neutral conversation model. Each provider adapter converts to/from these.

export type ToolCall = { id: string; name: string; input: Record<string, unknown> };

export type ImageMediaType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";
export type ImageContent = { mediaType: ImageMediaType; data: string };

export type ToolResult = { id: string; name: string; output: string; isError?: boolean; images?: ImageContent[] };

export type UserMessage = { role: "user"; text: string };
export type AssistantMessage = {
  role: "assistant";
  text: string;
  toolCalls: ToolCall[];
  // Provider-native content, replayed verbatim to the same provider so things like
  // thinking blocks / thought signatures survive. Other providers use text + toolCalls.
  raw?: { provider: string; content: unknown };
};
export type ToolMessage = { role: "tool"; results: ToolResult[] };
export type Message = UserMessage | AssistantMessage | ToolMessage;

/** Every tool call needs a result before the next user message; fills in any that are missing. */
export function closeOpenToolCalls(messages: Message[], output: string): void {
  const last = messages.at(-1);
  if (last?.role === "assistant" && last.toolCalls.length) {
    messages.push({ role: "tool", results: last.toolCalls.map((c) => ({ id: c.id, name: c.name, output, isError: true })) });
  } else if (last?.role === "tool") {
    const prev = messages.at(-2);
    if (prev?.role !== "assistant") return;
    const done = new Set(last.results.map((r) => r.id));
    for (const call of prev.toolCalls)
      if (!done.has(call.id)) last.results.push({ id: call.id, name: call.name, output, isError: true });
  }
}

/** Removes every image from tool results, noting it in the result text. Returns whether there were any. */
export function dropImages(messages: Message[], note: string): boolean {
  let dropped = false;
  for (const m of messages) {
    if (m.role !== "tool") continue;
    for (const r of m.results) {
      if (!r.images?.length) continue;
      delete r.images;
      r.output += `\n[${note}]`;
      dropped = true;
    }
  }
  return dropped;
}
