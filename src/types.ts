// Provider-neutral conversation types. Each provider adapter converts to/from these.

export type ToolCall = { id: string; name: string; input: Record<string, unknown> };
export type ImageContent = { mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp"; data: string };
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

export type ToolSpec = {
  name: string;
  description: string;
  parameters: { type: "object"; properties: Record<string, unknown>; required?: string[] };
};

export type StopReason = "end" | "tool_use" | "max_tokens" | "refusal" | "other";

export type TurnRequest = {
  model: string;
  system: string;
  messages: Message[];
  tools: ToolSpec[];
  signal: AbortSignal;
  onText: (delta: string) => void;
};

export type TurnResult = {
  message: AssistantMessage;
  stop: StopReason;
  usage?: { input: number; output: number };
};

export interface Provider {
  turn(req: TurnRequest): Promise<TurnResult>;
  /** Model ids available to the current credentials. */
  listModels(): Promise<string[]>;
}
