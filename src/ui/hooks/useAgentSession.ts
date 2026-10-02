import { useRef, useState } from "react";
import { providerInfo } from "../../adapters/providers/catalog.ts";
import { providerOf } from "../../adapters/providers/credentials.ts";
import type { Agent, AgentEvents, NoticeLevel } from "../../core/agent.ts";
import type { ToolCall } from "../../core/conversation.ts";
import { autoApproved, EDIT_TOOLS, type PermissionMode } from "../../core/settings.ts";
import type { Answer, Approve, AskQuestions, Question } from "../../core/tools.ts";
import type { ApprovalChoice, PendingApproval } from "../ApprovalDialog.tsx";
import { renderChange } from "../format.ts";
import type { Item } from "../Transcript.tsx";
import { useStreamedText } from "./useStreamedText.ts";

const VERBS = ["Thinking", "Pondering", "Working", "Crafting", "Computing", "Tinkering"];

export type PendingQuestionnaire = { questions: Question[]; resolve: (answers: Answer[] | null) => void };

type Options = {
  agent: Agent;
  mode: PermissionMode;
  push: (...items: Item[]) => void;
  notice: (text: string, level?: NoticeLevel) => void;
  /** Called before each turn; return false to hold the message back (e.g. to log in first). */
  canSend: (text: string) => boolean;
  /** "Always" on an edit approval switches the session to accept-edits. */
  onAllowEdits: () => void;
  /** Hands queued messages back to the input after an interrupt. */
  restoreInput: (text: string) => void;
};

/**
 * One conversation with the agent: running turns, queueing messages typed meanwhile,
 * interrupting, and answering the agent's approvals and questionnaires.
 */
export function useAgentSession({ agent, mode, push, notice, canSend, onAllowEdits, restoreInput }: Options) {
  const [running, setRunning] = useState(false);
  const [activeTool, setActiveTool] = useState<ToolCall | null>(null);
  const [approval, setApproval] = useState<PendingApproval | null>(null);
  const [questionnaire, setQuestionnaire] = useState<PendingQuestionnaire | null>(null);
  const [completedTurns, setCompletedTurns] = useState(0);
  const [verb, setVerb] = useState(VERBS[0]!);
  const [queued, setQueuedState] = useState<string[]>([]);
  const queue = useRef<string[]>([]);
  const setQueued = (q: string[]) => setQueuedState((queue.current = q));

  const controller = useRef<AbortController | null>(null);
  const denied = useRef(false);
  const sendNow = useRef(false); // interrupted to send the queue: run it instead of handing it back
  const alwaysAllow = useRef(new Set<string>());
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const stream = useStreamedText((text, first) => push({ kind: "assistant", text, first }));

  const approve: Approve = (req) => {
    if (autoApproved(modeRef.current, req.tool) || alwaysAllow.current.has(req.tool)) return Promise.resolve(true);
    return new Promise((resolve) => setApproval({ ...req, resolve }));
  };

  const askQuestions: AskQuestions = (questions, signal) =>
    new Promise((resolve) => {
      if (signal?.aborted) return resolve(null);
      const finish = (answers: Answer[] | null) => {
        signal?.removeEventListener("abort", abort);
        setQuestionnaire(null);
        resolve(answers);
      };
      const abort = () => finish(null);
      signal?.addEventListener("abort", abort, { once: true });
      setQuestionnaire({ questions, resolve: finish });
    });

  const events: AgentEvents = {
    approve,
    askQuestions,
    onText: stream.append,
    onStepEnd: stream.end,
    onToolStart: setActiveTool,
    onToolEnd(call, r) {
      setActiveTool(null);
      push({ kind: "tool", call, output: r.output, isError: r.isError, changePreview: r.change && renderChange(r.change) });
    },
    onNotice: notice,
  };

  function reportFailure(error: unknown, interrupted: boolean) {
    if (denied.current) notice("Denied. Tell megacode what to do instead.", "warn");
    else if (interrupted && sendNow.current) notice("Interrupted to send queued messages.");
    else if (interrupted) notice("Interrupted. What should megacode do instead?", "warn");
    else if ([401, 403].includes((error as { status?: number }).status!))
      notice(`${providerInfo(providerOf(agent.model)).label} rejected the credentials. Run /login to update them.`, "error");
    else notice((error as Error).message, "error");
  }

  async function send(text: string) {
    if (!canSend(text)) return;
    push({ kind: "user", text });
    setRunning(true);
    setVerb(VERBS[Math.floor(Math.random() * VERBS.length)]!);
    denied.current = false;
    sendNow.current = false;
    const ctrl = (controller.current = new AbortController());
    let interrupted = false;
    try {
      await agent.send(text, ctrl.signal, events);
      if (!ctrl.signal.aborted) setCompletedTurns((n) => n + 1);
    } catch (e) {
      stream.end();
      interrupted = ctrl.signal.aborted;
      reportFailure(e, interrupted);
    } finally {
      controller.current = null;
      setActiveTool(null);
      setRunning(false);
    }
    // Send queued messages next; after an interrupt (other than flushQueue), hand them back to the input instead.
    const next = queue.current.join("\n");
    setQueued([]);
    if (next && interrupted && !sendNow.current) restoreInput(next);
    else if (next) void send(next);
  }

  function interrupt() {
    if (approval) {
      approval.resolve(false);
      setApproval(null);
    }
    controller.current?.abort();
  }

  /** Runs the message now, or queues it for after the current turn. */
  function submit(text: string) {
    if (controller.current) setQueued([...queue.current, text]);
    else void send(text);
  }

  /** Stops the running turn so the queue is sent right away. */
  function flushQueue(extra?: string) {
    if (extra) setQueued([...queue.current, extra]);
    if (!queue.current.length) return;
    sendNow.current = true;
    interrupt();
  }

  function answerApproval(choice: ApprovalChoice) {
    if (!approval) return;
    if (choice === "always") {
      if (EDIT_TOOLS.has(approval.tool)) onAllowEdits();
      else alwaysAllow.current.add(approval.tool);
    }
    approval.resolve(choice !== "no");
    setApproval(null);
    if (choice === "no") {
      denied.current = true;
      controller.current?.abort();
    }
  }

  return {
    running,
    activeTool,
    approval,
    questionnaire,
    queued,
    verb,
    completedTurns,
    streaming: { text: stream.streaming, first: stream.first },
    submit,
    interrupt,
    flushQueue,
    answerApproval,
    /** Aborts any running turn without reporting it, e.g. when the app exits. */
    abort: () => controller.current?.abort(),
  };
}
