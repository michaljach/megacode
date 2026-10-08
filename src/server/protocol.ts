import type { ApprovalRequest, Answer, Question } from "../core/tools.ts";
import type { ToolCall } from "../core/conversation.ts";
import type { PermissionMode } from "../core/settings.ts";
import type { Item } from "../ui/transcript/ItemView.tsx";

/** The session's state, stripped of the non-serializable `resolve` hooks, as the
  wire form the iOS app receives. The iOS app replaces its local view on each `state`. */
export type ServerState = {
  running: boolean;
  /** Tool call currently in flight; drives the client's "waiting" indicator. */
  activeTool: ToolCall | null;
  /** Tool call awaiting a yes/no; the client shows the approval dialog. */
  approval: ApprovalRequest | null;
  /** Interactive questions awaiting answers; the client shows the questionnaire. */
  questionnaire: { questions: Question[] } | null;
  /** Messages queued during a running turn, in order. */
  queued: string[];
  /** Spinner label for the running turn. */
  verb: string;
  completedTurns: number;
  /** Current permission mode. */
  mode: PermissionMode;
};

/** One full session view. The session snapshot is immutable, so the client just
  replaces its local copy on every `state`. */
export type ServerSnapshot = {
  model: string;
  /** Where the model's credentials came from; `not configured` when none. */
  authStatus: string;
  state: ServerState;
  /** Finished transcript entries, in order. */
  items: Item[];
  /** Bumped on every clear; the client remounts its transcript on this change. */
  epoch: number;
  /** The not-yet-committed portion of the current assistant reply. */
  streaming: { text: string; first: boolean };
};

/** A command the iOS app sends the server. */
export type ClientCommand =
  | { type: "submit"; text: string }
  | { type: "interrupt" }
  | { type: "flushQueue"; text?: string }
  | { type: "sendQueued"; index: number }
  | { type: "answerApproval"; choice: "yes" | "always" | "no" }
  | { type: "answerQuestionnaire"; answers: Answer[] | null }
  | { type: "setMode"; mode: PermissionMode }
  | { type: "setModel"; spec: string }
  | { type: "clear" };

/** A message the server sends back. `state` carries the whole session; `restoreInput`
  repopulates the client's input after a plain interrupt; `error` reports a command
  that failed (e.g. an invalid model spec). */
export type ServerEvent =
  | { type: "state"; snapshot: ServerSnapshot }
  | { type: "restoreInput"; text: string }
  | { type: "error"; message: string };

/** The shape the server listens on. Port 0 picks a free port. */
export type ListenOptions = { host?: string; port?: number };
