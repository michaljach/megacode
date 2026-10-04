import assert from "node:assert/strict";
import { test } from "node:test";
import type { Key } from "ink";
import { globalShortcut, type ShortcutState } from "../src/ui/shortcuts.ts";

const idle: ShortcutState = { running: false, dialogOpen: false, blocking: false, hasInput: false, exitArmed: false };
const key = (pressed: Partial<Key> = {}) => pressed as Key;
const press = (input: string, pressed: Partial<Key>, state: Partial<ShortcutState> = {}) =>
  globalShortcut(input, key(pressed), { ...idle, ...state })?.type ?? null;

test("ctrl+c interrupts, closes a dialog, clears the input, then exits when pressed twice", () => {
  assert.equal(press("c", { ctrl: true }, { running: true, dialogOpen: true }), "interrupt");
  assert.equal(press("c", { ctrl: true }, { dialogOpen: true, hasInput: true }), "close-dialog");
  assert.equal(press("c", { ctrl: true }, { hasInput: true }), "clear-input");
  assert.equal(press("c", { ctrl: true }), "arm-exit");
  assert.equal(press("c", { ctrl: true }, { exitArmed: true }), "quit");
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
  assert.deepEqual(globalShortcut("3", key({ ctrl: true }), idle), { type: "send-queued", index: 2 });
  assert.equal(press("", { shift: true, tab: true }), "cycle-mode");
  assert.equal(press("", { escape: true }, { dialogOpen: true }), null);
  assert.equal(press("s", { ctrl: true }, { blocking: true }), null);
  assert.equal(press("x", {}), null);
});
