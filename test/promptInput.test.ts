import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { setTimeout } from "node:timers/promises";
import { createElement } from "react";
import { render } from "ink";
import { PromptInput } from "../src/ui/prompt/PromptInput.tsx";

test("late keyboard protocol replies do not become prompt text", async (t) => {
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {}, ref() {}, unref() {} });
  const stdout = Object.assign(new PassThrough(), { columns: 80, rows: 24 });
  stdout.resume();
  const changes: string[] = [];
  const app = render(createElement(PromptInput, {
    value: "", onChange: (value: string) => changes.push(value), onSubmit() {}, onHelp() {},
    isActive: true, history: [], autocomplete: false, suggestion: "", commands: [], placeholder: "Ask anything",
  }), {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stdout as unknown as NodeJS.WriteStream,
    exitOnCtrlC: false, patchConsole: false, interactive: true,
  });
  t.after(() => { app.unmount(); stdin.destroy(); stdout.destroy(); });
  await setTimeout(50);
  for (const flags of [0, 1, 31]) {
    stdin.write(`\u001b[?${flags}u`);
    await setTimeout(30);
  }
  assert.deepEqual(changes, []);
  stdin.write("hello");
  await setTimeout(30);
  assert.deepEqual(changes, ["hello"]);
});
