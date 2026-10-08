import type { Effort } from "./provider.ts";

export const PERMISSION_MODES = ["ask", "accept-edits", "yolo"] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

/** Tools that "accept edits" mode runs without asking. */
export const EDIT_TOOLS: ReadonlySet<string> = new Set(["write_file", "edit_file"]);

/** Whether the permission mode lets a tool run without asking the user. */
export const autoApproved = (mode: PermissionMode, tool: string) =>
  mode === "yolo" || (mode === "accept-edits" && EDIT_TOOLS.has(tool));

/** User preferences, edited with /config. */
export type Settings = {
  model?: string;
  effort?: Effort;
  permissionMode: PermissionMode;
  maxSteps: number;
  bashTimeoutMs: number;
  maxToolOutput: number;
  projectInstructions: boolean;
  saveHistory: boolean;
  promptAutocomplete: boolean;
  /** Show the last response's output speed on the status line. */
  showSpeed: boolean;
  /** Show how much of the model's context window the conversation fills on the status line. */
  showContext: boolean;
  /** What new worktrees branch from: the remote's default branch, or the current commit. */
  worktreeBase: "fresh" | "head";
};

export const DEFAULT_SETTINGS: Settings = {
  permissionMode: "yolo",
  maxSteps: 50,
  bashTimeoutMs: 120_000,
  maxToolOutput: 12_000,
  projectInstructions: true,
  saveHistory: true,
  promptAutocomplete: true,
  showSpeed: false,
  showContext: true,
  worktreeBase: "fresh",
};
