import { useState } from "react";
import { loadSettings } from "../../adapters/settings.ts";
import { readJson, writeJson } from "../../adapters/storage.ts";

const FILE = "history.json";
const MAX = 200;

/** Prompt history for ↑/↓, shared across sessions (unless turned off in /config), newest last. */
export function usePromptHistory() {
  const [history, setHistory] = useState(() => (loadSettings().saveHistory ? readJson<string[]>(FILE, []) : []));

  /** Moves the prompt to the end of the history and saves it. */
  function remember(prompt: string) {
    const next = [...history.filter((h) => h !== prompt), prompt];
    setHistory(next);
    if (loadSettings().saveHistory) writeJson(FILE, next.slice(-MAX));
  }

  return { history, remember };
}
