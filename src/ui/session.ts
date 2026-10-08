import { providerInfo } from "../adapters/providers/catalog.ts";
import { providerOf } from "../adapters/providers/credentials.ts";
import { isHttpErrorLike } from "../adapters/providers/shared.ts";
import type { Agent, AgentEvents, NoticeLevel } from "../core/agent.ts";
import type { ToolCall } from "../core/conversation.ts";
import { autoApproved, EDIT_TOOLS, type PermissionMode } from "../core/settings.ts";
import type { Answer, Approve, AskQuestions, Question } from "../core/tools.ts";
import type { ApprovalChoice, PendingApproval } from "./dialogs/ApprovalDialog.tsx";
import { buildDiff } from "./text/diff.ts";
import { displayOutput } from "./text/format.ts";
import { lastSafeBreak } from "./text/markdown.ts";
import type { Item } from "./transcript/ItemView.tsx";

const VERBS = ["Thinking", "Pondering", "Working", "Crafting", "Computing", "Tinkering"];

type PendingQuestionnaire = { questions: Question[]; resolve: (answers: Answer[] | null) => void };

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

/** The whole session at a moment: turn state, transcript, and the in-flight reply. */
export type SessionSnapshot = {
  state: SessionState;
  /** Finished entries, in order. */
  items: Item[];
  /** Bumped on every clear; the TUI remounts the transcript on this change. */
  epoch: number;
  streaming: { text: string; first: boolean };
};

/** What the session needs from the UI around it. The transcript and streamed text live
  inside the session, so nothing here is display-only. */
export type SessionHost = {
  /** Called before each turn; return false to hold the message back (e.g. to log in first). */
  canSend(text: string): boolean;
  /** The current permission mode, which the user can change mid-turn. */
  mode(): PermissionMode;
  /** Sets the permission mode (e.g. from a remote client). */
  setMode(mode: PermissionMode): void;
  /** "Always" on an edit approval switches the session to accept-edits. */
  onAllowEdits(): void;
  /** Hands queued messages back to the input after an interrupt. */
  restoreInput(text: string): void;
};

export type SessionAgent = Pick<Agent, "model" | "send" | "setModel" | "clear">;

/**
 * One conversation with the agent: running turns, the transcript, queued messages
 * typed meanwhile, the in-flight streamed reply, interrupting, and answering the
 * agent's approvals and questionnaires. The transcript and streaming live here,
 * not in React, so anything that owns the session (the TUI, a remote client)
 * reads the same conversation. State is an immutable snapshot; `subscribe`
  reports any change (turn state, transcript, or streaming).
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
  #items: Item[] = [{ kind: "banner" }];
  #epoch = 0;
  #streamBuffer = "";
  #streamFirst = true;
  #streamTimer: NodeJS.Timeout | null = null;
  #snapshot: SessionSnapshot;
  #listeners = new Set<() => void>();
  #controller: AbortController | null = null;
  #denied = false;
  #sendNow: number | "all" | null = null; // interrupted to send the queue (or one message of it) instead of handing it back
  #alwaysAllow = new Set<string>();
  readonly #agent: SessionAgent;
  readonly #host: SessionHost;

  constructor(agent: SessionAgent, host: SessionHost) {
    this.#agent = agent;
    this.#host = host;
    this.#snapshot = this.#makeSnapshot();
  }

  /** Stable across reads; a new reference only after a mutation. */
  get snapshot(): SessionSnapshot {
    return this.#snapshot;
  }
  /** Turn state only. */
  get state(): SessionState {
    return this.#snapshot.state;
  }
  /** Finished entries, in order. */
  get items(): Item[] {
    return this.#snapshot.items;
  }
  /** Bumped on every clear. */
  get epoch(): number {
    return this.#snapshot.epoch;
  }
  /** The not-yet-committed portion of the current assistant reply. */
  get streaming(): { text: string; first: boolean } {
    return this.#snapshot.streaming;
  }

  /** Subscribe to any session change; returns an unsubscribe. */
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  };

  #makeSnapshot(): SessionSnapshot {
    return {
      state: this.#state,
      items: this.#items,
      epoch: this.#epoch,
      streaming: { text: this.#streamText(), first: this.#streamFirst },
    };
  }

  #streamText(): string {
    return this.#streamBuffer;
  }

  /** Rebuild the snapshot from the current fields, then notify every listener. */
  #commit() {
    this.#snapshot = this.#makeSnapshot();
    for (const listener of this.#listeners) listener();
  }

  #update(patch: Partial<SessionState>) {
    this.#state = { ...this.#state, ...patch };
    this.#commit();
  }

  /** Appends finished entries to the transcript. */
  push = (...add: Item[]) => {
    if (!add.length) return;
    this.#items = [...this.#items, ...add];
    this.#commit();
  };

  notice = (text: string, level: NoticeLevel = "info") => this.push({ kind: "notice", text, level });
  /** Prominent, undimmed output, e.g. a report the user asked for. */
  print = (text: string) => this.push({ kind: "notice", text, level: "info", bright: true });

  /** Resets the transcript to the banner. The caller clears the terminal. */
  reset() {
    this.#streamReset();
    this.#items = [{ kind: "banner" }];
    this.#epoch++;
    this.#commit();
  }

  #streamReset() {
    this.#clearStreamTimer();
    this.#streamBuffer = "";
    this.#streamFirst = true;
  }

  #clearStreamTimer() {
    if (this.#streamTimer) {
      clearTimeout(this.#streamTimer);
      this.#streamTimer = null;
    }
  }

  /** A streamed assistant delta; finished paragraphs join the transcript after a short pause. */
  #appendStream(delta: string) {
    this.#streamBuffer += delta;
    this.#streamTimer ??= setTimeout(() => this.#flushStream(false), 40);
  }

  /** Commit all buffered text and start the next reply as fresh. */
  #commitStream() {
    this.#flushStream(true);
    this.#streamFirst = true;
    this.#commit();
  }

  #flushStream(all: boolean) {
    this.#clearStreamTimer();
    const text = this.#streamBuffer;
    const cut = all ? text.length : lastSafeBreak(text);
    if (cut > 0 && text.slice(0, cut).trim()) {
      this.#items = [...this.#items, { kind: "assistant", text: text.slice(0, cut).trim(), first: this.#streamFirst }];
      this.#streamFirst = false;
    }
    this.#streamBuffer = cut > 0 ? text.slice(cut) : text;
    this.#commit();
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
    this.#sendNow = "all";
    this.interrupt();
  };

  /** Stops the running turn to send the queued message at `index` right away; the rest stay queued. */
  sendQueued = (index: number) => {
    if (!this.#controller || index < 0 || index >= this.#state.queued.length) return;
    this.#sendNow = index;
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

  setModel = (spec: string) => this.#agent.setModel(spec);

  setMode = (mode: PermissionMode) => this.#host.setMode(mode);

  answerQuestionnaire = (answers: Answer[] | null) =>
    this.#state.questionnaire?.resolve(answers);

  clear = () => {
    this.#agent.clear();
    this.reset();
  };

  async #send(text: string): Promise<void> {
    const host = this.#host;
    if (!host.canSend(text)) return;
    const ctrl = (this.#controller = new AbortController());
    this.#denied = false;
    this.#sendNow = null;
    this.#update({ running: true, verb: VERBS[Math.floor(Math.random() * VERBS.length)]! });
    this.push({ kind: "user", text });
    let interrupted = false;
    try {
      await this.#agent.send(text, ctrl.signal, this.#events());
      if (!ctrl.signal.aborted) this.#update({ completedTurns: this.#state.completedTurns + 1 });
    } catch (e) {
      this.#commitStream(); // commit any half-streamed text
      interrupted = ctrl.signal.aborted;
      this.#reportFailure(e, interrupted);
    } finally {
      this.#controller = null;
      this.#update({ running: false, activeTool: null });
    }
    // Send queued messages next; after an interrupt (other than flushQueue/sendQueued), hand them back to the input instead.
    const { queued } = this.#state;
    const pick = this.#sendNow;
    if (!queued.length) return;
    if (interrupted && typeof pick === "number") {
      // The picked message runs now; the others wait for that turn to end.
      this.#update({ queued: queued.filter((_, i) => i !== pick) });
      return this.#send(queued[pick]!);
    }
    this.#update({ queued: [] });
    if (interrupted && pick === null) host.restoreInput(queued.join("\n"));
    else await this.#send(queued.join("\n"));
  }

  #reportFailure(error: unknown, interrupted: boolean) {
    const { label } = providerInfo(providerOf(this.#agent.model));
    if (this.#denied) this.notice("Denied. Tell megacode what to do instead.", "warn");
    else if (interrupted && this.#sendNow === "all") this.notice("Interrupted to send queued messages.");
    else if (interrupted && this.#sendNow !== null) this.notice("Interrupted to send a queued message.");
    else if (interrupted) this.notice("Interrupted. What should megacode do instead?", "warn");
    else if (isHttpErrorLike(error) && [401, 403].includes(error.status))
      this.notice(`${label} rejected the credentials. Run /login to update them.`, "error");
    else this.notice((error as Error).message, "error");
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
    return {
      approve: this.#approve,
      askQuestions: this.#askQuestions,
      onText: (delta) => this.#appendStream(delta),
      onStepEnd: () => this.#commitStream(),
      onToolStart: (call) => this.#update({ activeTool: call }),
      onToolEnd: (call, r) => {
        this.#update({ activeTool: null });
        // The transcript shows the whole edit; a new file shows its first lines, as in Claude Code.
        const diff = r.change && !r.isError ? buildDiff(r.change, r.change.created ? 10 : 60) : undefined;
        this.push({ kind: "tool", call, output: displayOutput(call, r, diff), isError: r.isError, diff: diff ?? undefined });
      },
      onNotice: (text, level) => this.notice(text, level),
    };
  }
}
