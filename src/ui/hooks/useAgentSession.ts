import { useRef, useState, useSyncExternalStore } from "react";
import { AgentSession, type SessionAgent, type SessionHost } from "../session.ts";
import { useStreamedText } from "./useStreamedText.ts";

/**
 * React binding for an AgentSession. The host callbacks may change on every render;
 * the session always calls the latest ones.
 */
export function useAgentSession(agent: SessionAgent, host: Omit<SessionHost, "onText" | "onStepEnd">) {
  const latest = useRef(host);
  latest.current = host;
  const stream = useStreamedText((text, first) => latest.current.push({ kind: "assistant", text, first }));
  const streamRef = useRef(stream);
  streamRef.current = stream;

  const [session] = useState(() =>
    new AgentSession(agent, {
      push: (...items) => latest.current.push(...items),
      notice: (text, level) => latest.current.notice(text, level),
      canSend: (text) => latest.current.canSend(text),
      mode: () => latest.current.mode(),
      onAllowEdits: () => latest.current.onAllowEdits(),
      restoreInput: (text) => latest.current.restoreInput(text),
      onText: (delta) => streamRef.current.append(delta),
      onStepEnd: () => streamRef.current.end(),
    }),
  );
  const state = useSyncExternalStore(session.subscribe, () => session.state);

  return {
    ...state,
    streaming: { text: stream.streaming, first: stream.first },
    submit: session.submit,
    interrupt: session.interrupt,
    flushQueue: session.flushQueue,
    answerApproval: session.answerApproval,
    abort: session.abort,
  };
}
