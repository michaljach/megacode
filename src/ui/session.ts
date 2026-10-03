import { providerInfo } from "../adapters/providers/catalog.ts";
import { providerOf } from "../adapters/providers/credentials.ts";
import type { Agent, AgentEvents, NoticeLevel } from "../core/agent.ts";
import type { ToolCall } from "../core/conversation.ts";
import { autoApproved, EDIT_TOOLS, type PermissionMode } from "../core/settings.ts";
import type { Answer, Approve, AskQuestions, Question } from "../core/tools.ts";
import type { ApprovalChoice, PendingApproval } from "./ApprovalDialog.tsx";
import { buildDiff } from "./diff.ts";
import { displayOutput } from "./format.ts";
import type { Item } from "./Transcript.tsx";

const VERBS = ["Thinking", "Pondering", "Working", "Crafting", "Computing", "Tinkering"];

export type PendingQuestionnaire = { questions: Question[]; resolve: (answers: Answer[] | null) => void };

export type SessionState = {
  running: boolean;
  activeTool: ToolCall | null;
  approval: PendingApproval | null;
  questionnaire: PendingQuestionnaire | null;
  /** Messages typed while a turn runs; sent together when it ends. */
  queued: string[];
  /** Spinner label for the running turn. */
  verb: string;
  completedTurns: number;
};

/** What the session needs from the UI around it. */
export type SessionHost = {
  push(...items: Item[]): void;
  notice(text: string, level?: NoticeLevel): void;
  /** Called before each turn; return false to hold the message back (e.g. to log in first). */
  canSend(text: string): boolean;
  /** The current permission mode, which the user can change mid-turn. */
  mode(): PermissionMode;
  /** "Always" on an edit approval switches the session to accept-edits. */
  onAllowEdits(): void;
  /** Hands queued messages back to the input after an interrupt. */
  restoreInput(text: string): void;
  /** Streamed assistant text. */
  onText(delta: string): void;
  onStepEnd(): void;
};

export type SessionAgent = Pick<Agent, "model" | "send">;

/**
 * One conversation with the agent, independent of React: running turns, queueing messages typed
 * meanwhile, interrupting, and answering the agent's approvals and questionnaires.
 * State is an immutable snapshot; `subscribe` reports changes.
 */
export class AgentSession {
  #state: SessionState = {
    running: false,
    activeTool: null,
    approval: null,
    questionnaire: null,
    queued: [],
    verb: VERBS[0]!,
    completedTurns: 0,
  };
  #listeners = new Set<() => void>();
  #controller: AbortController | null = null;
  #denied = false;
  #sendNow = false; // interrupted to send the queue: run it instead of handing it back
  #alwaysAllow = new Set<string>();
  readonly #agent: SessionAgent;
  readonly #host: SessionHost;

  constructor(agent: SessionAgent, host: SessionHost) {
    this.#agent = agent;
    this.#host = host;
  }

  get state(): SessionState {
    return this.#state;
  }

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  };

  #update(patch: Partial<SessionState>) {
    this.#state = { ...this.#state, ...patch };
    for (const listener of this.#listeners) listener();
  }

  /** Runs the message now, or queues it for after the current turn. Resolves when the session is idle again. */
  submit = (text: string): Promise<void> => {
    if (!this.#controller) return this.#send(text);
    this.#update({ queued: [...this.#state.queued, text] });
    return Promise.resolve();
  };

  /** Stops the running turn and denies a pending approval. Queued messages go back to the input. */
  interrupt = () => {
    const { approval } = this.#state;
    if (approval) {
      approval.resolve(false);
      this.#update({ approval: null });
    }
    this.#controller?.abort();
  };

  /** Adds `extra` to the queue, then stops the running turn so the queue is sent right away. */
  flushQueue = (extra?: string) => {
    if (extra) this.#update({ queued: [...this.#state.queued, extra] });
    if (!this.#state.queued.length) return;
    this.#sendNow = true;
    this.interrupt();
  };

  answerApproval = (choice: ApprovalChoice) => {
    const { approval } = this.#state;
    if (!approval) return;
    if (choice === "always") {
      if (EDIT_TOOLS.has(approval.tool)) this.#host.onAllowEdits();
      else this.#alwaysAllow.add(approval.tool);
    }
    approval.resolve(choice !== "no");
    this.#update({ approval: null });
    if (choice === "no") {
      this.#denied = true;
      this.#controller?.abort();
    }
  };

  /** Aborts any running turn without reporting it, e.g. when the app exits. */
  abort = () => this.#controller?.abort();

  async #send(text: string): Promise<void> {
    const host = this.#host;
    if (!host.canSend(text)) return;
    host.push({ kind: "user", text });
    const ctrl = (this.#controller = new AbortController());
    this.#denied = false;
    this.#sendNow = false;
    this.#update({ running: true, verb: VERBS[Math.floor(Math.random() * VERBS.length)]! });
    let interrupted = false;
    try {
      await this.#agent.send(text, ctrl.signal, this.#events());
      if (!ctrl.signal.aborted) this.#update({ completedTurns: this.#state.completedTurns + 1 });
    } catch (e) {
      host.onStepEnd(); // commit any half-streamed text
      interrupted = ctrl.signal.aborted;
      this.#reportFailure(e, interrupted);
    } finally {
      this.#controller = null;
      this.#update({ running: false, activeTool: null });
    }
    // Send queued messages next; after an interrupt (other than flushQueue), hand them back to the input instead.
    const next = this.#state.queued.join("\n");
    this.#update({ queued: [] });
    if (next && interrupted && !this.#sendNow) host.restoreInput(next);
    else if (next) await this.#send(next);
  }

  #reportFailure(error: unknown, interrupted: boolean) {
    const { notice } = this.#host;
    if (this.#denied) notice("Denied. Tell megacode what to do instead.", "warn");
    else if (interrupted && this.#sendNow) notice("Interrupted to send queued messages.");
    else if (interrupted) notice("Interrupted. What should megacode do instead?", "warn");
    else if ([401, 403].includes((error as { status?: number }).status!))
      notice(`${providerInfo(providerOf(this.#agent.model)).label} rejected the credentials. Run /login to update them.`, "error");
    else notice((error as Error).message, "error");
  }

  #approve: Approve = (req) => {
    if (autoApproved(this.#host.mode(), req.tool) || this.#alwaysAllow.has(req.tool)) return Promise.resolve(true);
    return new Promise((resolve) => this.#update({ approval: { ...req, resolve } }));
  };

  #askQuestions: AskQuestions = (questions, signal) =>
    new Promise((resolve) => {
      if (signal?.aborted) return resolve(null);
      const finish = (answers: Answer[] | null) => {
        signal?.removeEventListener("abort", abort);
        this.#update({ questionnaire: null });
        resolve(answers);
      };
      const abort = () => finish(null);
      signal?.addEventListener("abort", abort, { once: true });
      this.#update({ questionnaire: { questions, resolve: finish } });
    });

  #events(): AgentEvents {
    const host = this.#host;
    return {
      approve: this.#approve,
      askQuestions: this.#askQuestions,
      onText: (delta) => host.onText(delta),
      onStepEnd: () => host.onStepEnd(),
      onToolStart: (call) => this.#update({ activeTool: call }),
      onToolEnd: (call, r) => {
        this.#update({ activeTool: null });
        // The transcript shows the whole edit; a new file shows its first lines, as in Claude Code.
        const diff = r.change && !r.isError ? buildDiff(r.change, r.change.created ? 10 : 60) : undefined;
        host.push({ kind: "tool", call, output: displayOutput(call, r, diff), isError: r.isError, diff: diff ?? undefined });
      },
      onNotice: (text, level) => host.notice(text, level),
    };
  }
}
