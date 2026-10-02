import { useEffect, useRef, useState } from "react";
import type { Agent } from "../agent.ts";
import { lastSafeBreak } from "./format.ts";

/**
 * Buffers streamed assistant text. Finished paragraphs go to `commit` (into <Static>) so the
 * live area stays short; `streaming` is the unfinished rest.
 */
export function useStreamedText(commit: (text: string, first: boolean) => void) {
  const [streaming, setStreaming] = useState("");
  const buffer = useRef("");
  const first = useRef(true); // the next committed chunk starts a new reply
  const timer = useRef<NodeJS.Timeout | null>(null);

  const flush = (all: boolean) => {
    timer.current = null;
    const text = buffer.current;
    const cut = all ? text.length : lastSafeBreak(text);
    if (cut > 0 && text.slice(0, cut).trim()) {
      commit(text.slice(0, cut).trim(), first.current);
      first.current = false;
    }
    buffer.current = cut > 0 ? text.slice(cut) : text;
    setStreaming(buffer.current);
  };

  return {
    streaming,
    first: first.current,
    append(delta: string) {
      buffer.current += delta;
      timer.current ??= setTimeout(() => flush(false), 40);
    },
    /** Commit everything; the next text starts a new reply. */
    end() {
      if (timer.current) clearTimeout(timer.current);
      flush(true);
      first.current = true;
    },
  };
}

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
