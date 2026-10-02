import { useEffect, useState } from "react";
import type { Agent } from "../../core/agent.ts";

/**
 * Asks the model for a next-prompt suggestion after each completed turn. Any change
 * (new turn, /clear, model switch) drops the current suggestion and cancels a pending one.
 */
export function usePromptSuggestion(
  agent: Agent,
  { enabled, running, completedTurn, epoch, model }: { enabled: boolean; running: boolean; completedTurn: number; epoch: number; model: string },
): string {
  const [suggestion, setSuggestion] = useState("");
  useEffect(() => {
    setSuggestion("");
    if (!enabled || running || !completedTurn || !agent.messages.length) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      void agent.suggestPrompt(ctrl.signal).then((text) => {
        if (!ctrl.signal.aborted) setSuggestion(text);
      }).catch(() => {}); // Optional suggestions must never disrupt the main conversation.
    }, 300);
    const timeout = setTimeout(() => ctrl.abort(), 15_000);
    return () => { clearTimeout(timer); clearTimeout(timeout); ctrl.abort(); };
  }, [agent, enabled, running, completedTurn, epoch, model]);
  return suggestion;
}
