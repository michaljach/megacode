import type { Message } from "./conversation.ts";
import { elideMiddle } from "./elide.ts";
import { COMPACT_SYSTEM } from "./prompts.ts";
import { ContextOverflowError, type Provider, type Usage } from "./provider.ts";

/** Compact once the last request used this share of the model's context window.
 * Lower threshold keeps the conversation smaller so the cacheable prefix
 * (system prompt + tools + recent messages) dominates more turns. */
export const COMPACT_AT = 0.6;

/** Transcript characters per token of context window: about half the window at a conservative 4 characters per token. */
const CHARS_PER_WINDOW_TOKEN = 2;
/** Transcript budget when the window is unknown; fits a 64k-token model. */
const DEFAULT_BUDGET = 120_000;
const TEXT_CHARS = 6_000;
const TOOL_CHARS = 1_500;
const ATTEMPTS = 3;

const SUMMARY_INTRO = "This conversation was compacted to fit the model's context window. Summary of everything before this point:";
const CONTINUE = "Continue the work from where it left off, without asking the user to repeat anything.";

/** One message as plain text for the summarizer; long text and tool output keep their start and end. */
function describe(m: Message): string {
  if (m.role === "user") return `[user]\n${elideMiddle(m.text, TEXT_CHARS)}`;
  if (m.role === "tool")
    return m.results.map((r) => `[${r.name} ${r.isError ? "error" : "result"}]\n${elideMiddle(r.output, TOOL_CHARS)}`).join("\n\n");
  const calls = m.toolCalls.map((c) => `[assistant called ${c.name}] ${elideMiddle(JSON.stringify(c.input), TOOL_CHARS)}`);
  return [m.text && `[assistant]\n${elideMiddle(m.text, TEXT_CHARS)}`, ...calls].filter(Boolean).join("\n");
}

/**
 * The history as plain text of about `budget` characters at most: the first message (the original task, or an earlier
 * summary) in up to half of it, then as many of the latest messages as fit.
 */
export function compactionTranscript(messages: Message[], budget: number): string {
  const [whole = "", ...rest] = messages.map(describe).filter(Boolean);
  const first = elideMiddle(whole, Math.floor(budget / 2));
  const kept: string[] = [];
  let size = first.length;
  for (const part of rest.toReversed()) {
    if (size + part.length > budget) break;
    kept.unshift(part);
    size += part.length + 2;
  }
  const omitted = rest.length - kept.length;
  return [first, ...(omitted ? [`[${omitted} earlier messages omitted]`] : []), ...kept].join("\n\n");
}

/**
 * Compact the conversation to fit the model's context window. Returns a two-part history:
 * a summary of the older conversation, followed by recent messages kept verbatim.
 * Keeping recent messages verbatim lets the provider's prompt cache reuse them across turns,
 * because they stay identical from one turn to the next.
 */
export async function compactHistory(
  provider: Provider,
  { model, messages, contextWindow, continuing, signal }: {
    model: string;
    messages: Message[];
    contextWindow: number | null;
    continuing: boolean;
    signal: AbortSignal;
  },
): Promise<{ messages: Message[]; usage: Usage }> {
  const usage: Usage = { input: 0, output: 0 };
  let budget = contextWindow ? contextWindow * CHARS_PER_WINDOW_TOKEN : DEFAULT_BUDGET;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await provider.turn({
        model,
        system: COMPACT_SYSTEM,
        messages: [{ role: "user", text: compactionTranscript(messages, budget) }],
        tools: [],
        signal,
        onText: () => {},
      });
      usage.input += res.usage?.input ?? 0;
      usage.output += res.usage?.output ?? 0;
      const summary = res.message.text.trim();
      if (!summary) throw new Error("Couldn't compact the conversation: the model returned an empty summary. Run /clear to start over.");
      const compacted = [{ role: "user" as const, text: [SUMMARY_INTRO, summary, ...(continuing ? [CONTINUE] : [])].join("\n\n") }];
      // Recent messages: keep the last N exchanges verbatim so the provider's prompt cache
      // can reuse them across turns (they stay identical). Budget 4000 chars for recent
      // (about 2-3 full exchanges) so the cacheable prefix stays large.
      const recentBudget = Math.min(4000, budget - compacted[0].text.length);
      const recent: Message[] = [];
      for (const m of messages.toReversed()) {
        const text = m.role === "tool" ? m.results.map((r) => r.output).join("\n") : m.text;
        if (recent.some((r) => r === m)) continue; // skip duplicates
        if (recentBudget && text.length > recentBudget) break;
        recent.unshift(m);
      }
      return { messages: [...compacted, ...recent], usage };
    } catch (e) {
      if (!(e instanceof ContextOverflowError) || attempt === ATTEMPTS) throw e;
      budget = Math.floor(budget / 2);
    }
  }
}
