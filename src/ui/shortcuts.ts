import type { Key } from "ink";

/** What the app is doing, as far as the global shortcuts care. */
export type ShortcutState = { running: boolean; dialogOpen: boolean; blocking: boolean; hasInput: boolean; exitArmed: boolean };

export type Shortcut =
  | { type: "interrupt" | "close-dialog" | "clear-input" | "arm-exit" | "quit" | "send-queue" | "cycle-mode" }
  | { type: "send-queued"; index: number };

/**
 * What a key does at the app level (the shortcuts table in README.md), or null to leave it to the prompt or the open
 * dialog. ctrl+c steps down: interrupt, close the dialog, clear the input, then exit when pressed twice.
 */
export function globalShortcut(input: string, key: Key, s: ShortcutState): Shortcut | null {
  if (key.ctrl && input === "c") {
    if (s.running) return { type: "interrupt" };
    if (s.dialogOpen) return { type: "close-dialog" };
    if (s.hasInput) return { type: "clear-input" };
    return { type: s.exitArmed ? "quit" : "arm-exit" };
  }
  if (key.ctrl && input === "d" && !s.hasInput && !s.running) return { type: "quit" };
  if (s.blocking || s.dialogOpen) return null; // those dialogs handle their own keys
  if (key.ctrl && input === "s") return { type: "send-queue" };
  if (key.ctrl && /^[1-9]$/.test(input)) return { type: "send-queued", index: Number(input) - 1 };
  if (key.escape) return { type: s.running ? "interrupt" : "clear-input" };
  if (key.shift && key.tab) return { type: "cycle-mode" };
  return null;
}
