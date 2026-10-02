import { useRef, useState } from "react";
import { lastSafeBreak } from "../format.ts";

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
