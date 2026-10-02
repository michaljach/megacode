type ContentPart = { type: string; text?: string; mimeType?: string; uri?: string; resource?: { uri: string; text?: string } };

function formatPart(p: ContentPart): string {
  switch (p.type) {
    case "text":
      return p.text ?? "";
    case "resource":
      return p.resource?.text ?? `[resource ${p.resource?.uri}]`;
    case "resource_link":
      return `[resource ${p.uri}]`;
    default:
      return `[${p.type}${p.mimeType ? ` ${p.mimeType}` : ""} omitted]`;
  }
}

/** An MCP tool result as text for the model: content parts, else structured content as JSON. */
export function formatResult(res: { content?: unknown; structuredContent?: unknown; toolResult?: unknown }): string {
  const parts = Array.isArray(res.content) ? (res.content as ContentPart[]) : [];
  const text = parts.map(formatPart).join("\n");
  if (text) return text;
  const structured = res.structuredContent ?? res.toolResult;
  return structured === undefined ? "(no output)" : JSON.stringify(structured, null, 2);
}
