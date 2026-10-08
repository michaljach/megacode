import assert from "node:assert/strict";
import { test } from "node:test";
import type { Key } from "ink";
import { globalShortcut, type ShortcutState } from "../src/ui/shortcuts.ts";

const idle: ShortcutState = { running: false, dialogOpen: false, blocking: false, hasInput: false, exitArmed: false, exitPrompt: false };
const key = (pressed: Partial<Key> = {}) => pressed as Key;
/** The actions a key press runs, in order, joined: "interrupt+arm-exit". Empty when the app leaves the key alone. */
const press = (input: string, pressed: Partial<Key>, state: Partial<ShortcutState> = {}) =>
  globalShortcut(input, key(pressed), { ...idle, ...state }).map((s) => s.type).join("+") || null;

test("ctrl+c interrupts, closes a dialog or clears the input, arming exit each time; alone it just arms exit", () => {
  assert.equal(press("c", { ctrl: true }, { running: true, dialogOpen: true }), "interrupt+arm-exit");
  assert.equal(press("c", { ctrl: true }, { dialogOpen: true, hasInput: true }), "close-dialog+arm-exit");
  assert.equal(press("c", { ctrl: true }, { hasInput: true }), "clear-input+arm-exit");
  assert.equal(press("c", { ctrl: true }), "arm-exit");
});

test("a second ctrl+c exits whatever the app is doing, even a turn that ignores the interrupt", () => {
  for (const state of [{}, { running: true }, { dialogOpen: true }, { hasInput: true }, { blocking: true, running: true }])
    assert.equal(press("c", { ctrl: true }, { ...state, exitArmed: true }), "quit", JSON.stringify(state));
});

test("ctrl+c at the exit prompt (leaving a worktree) exits", () => {
  assert.equal(press("c", { ctrl: true }, { dialogOpen: true, exitPrompt: true }), "quit");
});

test("ctrl+d exits only with an empty input and no running turn", () => {
  assert.equal(press("d", { ctrl: true }), "quit");
  assert.equal(press("d", { ctrl: true }, { hasInput: true }), null);
  assert.equal(press("d", { ctrl: true }, { running: true }), null);
});

test("esc interrupts a running turn, otherwise clears the input", () => {
  assert.equal(press("", { escape: true }, { running: true }), "interrupt");
  assert.equal(press("", { escape: true }), "clear-input");
});

test("queue and mode shortcuts, left to dialogs while one is open", () => {
  assert.equal(press("s", { ctrl: true }), "send-queue");
  assert.deepEqual(globalShortcut("3", key({ ctrl: true }), idle), [{ type: "send-queued", index: 2 }]);
  assert.equal(press("", { shift: true, tab: true }), "cycle-mode");
  assert.equal(press("", { escape: true }, { dialogOpen: true }), null);
  assert.equal(press("s", { ctrl: true }, { blocking: true }), null);
  assert.equal(press("x", {}), null);
});
