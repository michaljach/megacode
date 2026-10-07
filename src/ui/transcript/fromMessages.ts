import type { Message } from "../../core/conversation.ts";
import { displayOutput } from "../text/format.ts";
import type { Item } from "./ItemView.tsx";

/**
 * Transcript entries for a saved conversation: user messages, replies, and each tool call with its result. Diffs
 * aren't saved, so edits show their summary line.
 */
export function itemsFromMessages(messages: Message[]): Item[] {
  return messages.flatMap((m, i): Item[] => {
    if (m.role === "user") return [{ kind: "user", text: m.text }];
    if (m.role === "tool") return []; // shown with the calls they answer
    const next = messages[i + 1];
    const results = next?.role === "tool" ? next.results : [];
    const reply: Item[] = m.text.trim() ? [{ kind: "assistant", text: m.text.trim(), first: true }] : [];
    return [
      ...reply,
      ...m.toolCalls.map((call): Item => {
        const result = results.find((r) => r.id === call.id);
        const isError = result?.isError ?? false;
        return { kind: "tool", call, output: result ? displayOutput(call, { output: result.output, isError }) : "", isError };
      }),
    ];
  });
}
