import type { AssistantMessage, Message } from "./conversation.ts";
import type { ToolSpec } from "./tools.ts";

export type StopReason = "end" | "tool_use" | "max_tokens" | "refusal" | "other";

export const EFFORTS = ["default", "low", "medium", "high"] as const;
export type Effort = (typeof EFFORTS)[number];

/** The effort to request explicitly, or undefined to leave the provider's default in place. */
export const explicitEffort = (effort: Effort | undefined) => (effort === "default" ? undefined : effort);

export type Usage = {
  input: number;
  output: number;
  /** When reported separately, these components sum to input. */
  inputBreakdown?: { uncached: number; cacheRead: number; cacheCreation: number };
};

export type TurnRequest = {
  effort?: Effort;
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
  usage?: Usage;
  /** Model identity reported by the backend, if available. */
  responseModel?: string;
};

/** Port implemented by every model backend (Anthropic, OpenAI, Gemini, …). */
export interface Provider {
  turn(req: TurnRequest): Promise<TurnResult>;
  /** Model ids available to the current credentials. */
  listModels(): Promise<string[]>;
}

/** Resolves a "provider:model" spec to a provider instance and the provider's model id. Throws if invalid. */
export type ModelResolver = (spec: string) => { provider: Provider; model: string };

/** "provider:model" → parts. Splits on the first colon only: Ollama tags contain colons. */
export function parseModelSpec(spec: string): { provider: string; model?: string } {
  const i = spec.indexOf(":");
  return i === -1 ? { provider: spec } : { provider: spec.slice(0, i), model: spec.slice(i + 1) };
}
