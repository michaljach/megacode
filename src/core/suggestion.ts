import type { Message } from "./conversation.ts";
import { SUGGEST_SYSTEM } from "./prompts.ts";
import type { Provider, Usage } from "./provider.ts";

const MAX_LENGTH = 160;
const CONTEXT_MESSAGES = 12;

/** Suggestions only follow a finished assistant reply with text, not a pending tool call. */
export function canSuggest(messages: Message[]): boolean {
  const last = messages.at(-1);
  return last?.role === "assistant" && !last.toolCalls.length && !!last.text.trim();
}

/** Recent history, trimmed, as data for the suggestion model. */
function transcript(messages: Message[]): string {
  return JSON.stringify(messages.slice(-CONTEXT_MESSAGES).map((m) =>
    m.role === "tool"
      ? { role: "tool", results: m.results.map((r) => ({ name: r.name, output: r.output.slice(-1500), isError: r.isError })) }
      : { role: m.role, text: m.text.slice(-4000) },
  ));
}

const isUsable = (text: string) =>
  text !== "NONE" && text.length <= MAX_LENGTH && !/[\r\n]/.test(text) && !text.startsWith("/");

/** Isolated, tool-free next-prompt prediction. Returns "" when there's nothing worth suggesting. */
export async function suggestNextPrompt(
  provider: Provider,
  model: string,
  messages: Message[],
  signal: AbortSignal,
): Promise<{ text: string; usage?: Usage }> {
  const result = await provider.turn({
    model,
    system: SUGGEST_SYSTEM,
    messages: [{ role: "user", text: transcript(messages) }],
    tools: [],
    signal,
    onText: () => {},
  });
  const text = result.message.text.trim();
  const ok = result.stop === "end" && !result.message.toolCalls.length && isUsable(text);
  return { text: ok ? text : "", usage: result.usage };
}
