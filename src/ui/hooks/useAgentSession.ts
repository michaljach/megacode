import { useRef, useState, useSyncExternalStore } from "react";
import { AgentSession, type SessionAgent, type SessionHost } from "../session.ts";

/**
 * React binding for an AgentSession. The host callbacks change on every render; the session
  always calls the latest ones. The session owns the transcript and the in-flight reply, so
  they come from its snapshot, which is stable across reads and re-referenced only on a change.
 */
export function useAgentSession(agent: SessionAgent, host: SessionHost) {
  const latest = useRef(host);
  latest.current = host;
  const [session] = useState(
    () => new AgentSession(agent, {
      canSend: (text) => latest.current.canSend(text),
      mode: () => latest.current.mode(),
      setMode: (mode) => latest.current.setMode(mode),
      onAllowEdits: () => latest.current.onAllowEdits(),
      restoreInput: (text) => latest.current.restoreInput(text),
    }),
  );
  const { state, items, epoch, streaming } = useSyncExternalStore(
    session.subscribe,
    () => session.snapshot,
    () => session.snapshot,
  );
  return { session, state, items, epoch, streaming };
}
