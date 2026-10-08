import type { Key } from "ink";

/** What the app is doing, as far as the global shortcuts care. `exitPrompt`: the "keep or remove worktree" question. */
export type ShortcutState = {
  running: boolean;
  dialogOpen: boolean;
  blocking: boolean;
  hasInput: boolean;
  exitArmed: boolean;
  exitPrompt: boolean;
};

export type Shortcut =
  | { type: "interrupt" | "close-dialog" | "clear-input" | "arm-exit" | "quit" | "send-queue" | "cycle-mode" }
  | { type: "send-queued"; index: number };

const ARM_EXIT: Shortcut = { type: "arm-exit" };

/** ctrl+c steps down (interrupt, close the dialog, clear the input) and arms exit; pressed again soon after, it exits. */
function ctrlC(s: ShortcutState): Shortcut[] {
  // Checked first, so a turn that ignores the interrupt or a dialog that reopens can't keep the app open.
  if (s.exitArmed || s.exitPrompt) return [{ type: "quit" }];
  if (s.running) return [{ type: "interrupt" }, ARM_EXIT];
  if (s.dialogOpen) return [{ type: "close-dialog" }, ARM_EXIT];
  if (s.hasInput) return [{ type: "clear-input" }, ARM_EXIT];
  return [ARM_EXIT];
}

/**
 * What a key does at the app level (the shortcuts table in README.md), in order; empty to leave it to the prompt or
 * the open dialog.
 */
export function globalShortcut(input: string, key: Key, s: ShortcutState): Shortcut[] {
  if (key.ctrl && input === "c") return ctrlC(s);
  if (key.ctrl && input === "d" && !s.hasInput && !s.running) return [{ type: "quit" }];
  if (s.blocking || s.dialogOpen) return []; // those dialogs handle their own keys
  if (key.ctrl && input === "s") return [{ type: "send-queue" }];
  if (key.ctrl && /^[1-9]$/.test(input)) return [{ type: "send-queued", index: Number(input) - 1 }];
  if (key.escape) return [{ type: s.running ? "interrupt" : "clear-input" }];
  if (key.shift && key.tab) return [{ type: "cycle-mode" }];
  return [];
}
