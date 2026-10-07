import { useEffect, useState } from "react";
import { newSessionId, saveSession } from "../../adapters/sessions.ts";
import type { Agent } from "../../core/agent.ts";

/**
 * Saves the conversation after every turn under an id that `megacode --resume <id>` takes. `restart` gives the next
 * conversation (after /clear) a new id. Failing to save never interrupts the session.
 */
export function useSavedSession(agent: Pick<Agent, "messages" | "model">, initialId: string, running: boolean) {
  const [id, setId] = useState(initialId);

  /** Writes the conversation now, if it has started. */
  async function save() {
    if (!agent.messages.length) return;
    await saveSession({ id, cwd: process.cwd(), model: agent.model, messages: agent.messages }).catch(() => {});
  }

  useEffect(() => {
    if (!running) void save();
  }, [running]);

  return { id, save, restart: () => setId(newSessionId()) };
}
