import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { stripVTControlCharacters } from 'node:util';
import { createElement } from 'react';
import { Box, Static, Text, renderToString } from 'ink';
import { ItemView } from '../src/ui/transcript/ItemView.tsx';
import { previewPrompt } from '../src/ui/text/format.ts';
import { buildDiff } from '../src/ui/text/diff.ts';
import { PromptInput } from '../src/ui/prompt/PromptInput.tsx';
import { Questionnaire } from '../src/ui/dialogs/Questionnaire.tsx';

test('questionnaire renders choices, custom answers, and progress', () => {
  const view = (questions) => stripVTControlCharacters(renderToString(createElement(Questionnaire, {
    questions, onSubmit() {}, onCancel() {},
  }), { columns: 80 }));
  const choices = view([{ question: 'Which framework?', options: ['React', 'Vue'] }, { question: 'Constraints?' }]);
  assert.match(choices, /Question 1 of 2/);
  assert.match(choices, /Which framework\?/);
  assert.match(choices, /React/);
  assert.match(choices, /Other — type an answer/);
  assert.match(choices, /esc cancel/);
  assert.match(view([{ question: 'Constraints?' }]), /Type your answer/);
});

test('prompt displays contextual ghost text only when enabled and matching', () => {
  const props = {
    value: '', suggestion: 'Run the tests', autocomplete: true, isActive: true,
    onChange() {}, onSubmit() {}, onHelp() {}, history: [], commands: [], placeholder: 'Ask anything',
  };
  const view = (patch = {}) => stripVTControlCharacters(renderToString(createElement(PromptInput, { ...props, ...patch }), { columns: 80 }));
  assert.match(view(), /Run the tests/);
  assert.match(view(), /tab to accept/);
  assert.doesNotMatch(view({ autocomplete: false }), /Run the tests|tab to accept/);
  assert.doesNotMatch(view({ value: 'Fix the bug' }), /Run the tests|tab to accept/);
  assert.doesNotMatch(view({ isActive: false }), /Run the tests|tab to accept/);
});

test('a remembered local model opens the prompt instead of first-run login', async (t) => {
  const { App } = await import('../src/ui/App.tsx');
  const { createAgent } = await import('../src/composition.ts');
  const { defaultModel } = await import('../src/adapters/providers/registry.ts');
  const { updateSettings } = await import('../src/adapters/settings.ts');
  const { setConfigDir, configDir } = await import('../src/adapters/storage.ts');
  const dir = mkdtempSync(join(tmpdir(), 'megacode-startup-'));
  const previousDir = configDir();
  t.after(() => { setConfigDir(previousDir); rmSync(dir, { recursive: true, force: true }); });
  setConfigDir(dir);
  const env = { ...process.env };
  t.after(() => { process.env = env; });
  delete process.env.MEGACODE_MODEL;
  for (const name of Object.keys(process.env).filter(name => /API_KEY|AUTH_TOKEN|BASE_URL/.test(name))) delete process.env[name];
  for (const model of ['ollama:llama3.2', 'lmstudio:local-model']) {
    updateSettings({ model });
    assert.equal(defaultModel(), model);
    const output = stripVTControlCharacters(renderToString(createElement(App, {
      agent: createAgent(defaultModel()), initialMode: 'ask',
    }), { columns: 80 }));
    assert.doesNotMatch(output, /Connect a model provider to get started/);
  }
});

const renderItem = (item, columns) => stripVTControlCharacters(renderToString(
  createElement(ItemView, { item, model: 'test' }), { columns },
)).split('\n').filter(line => line.trim());

const prompt = 'make benchamrk table better to visualise codex vs megacode and possibly other in future';

for (const columns of [20, 40, 57, 80]) {
  test(`short assistant replies use the available width at ${columns} columns`, () => {
    const text = 'Ready. What would you like me to test?';
    for (const first of [true, false]) {
      const output = stripVTControlCharacters(renderToString(
        createElement(Box, { flexDirection: 'column' },
          createElement(Static, {
            items: [{ kind: 'assistant', text, first }], style: { width: '100%' },
          }, (item, key) => createElement(ItemView, { key, item, model: 'test' })),
        ), { columns },
      ));
      const lines = output.split('\n').filter(line => line.trim());
      assert.ok(lines[0].startsWith(first ? '⏺ Ready.' : '  Ready.'), output);
      assert.ok(lines.every(line => line.length <= columns), output);
      assert.ok(lines.slice(1).every(line => line.startsWith('  ')), output);
      assert.equal(lines.map(line => line.slice(2)).join('').replace(/\s/g, ''), text.replace(/\s/g, ''));
      if (columns >= text.length + 2) assert.equal(lines.length, 1, output);
    }
  });

  test(`tool output keeps its width and indentation at ${columns} columns`, () => {
    const path = '/Users/example/dev/megacode/.megacode/worktrees/nimble-river-737';
    for (const isError of [false, true]) {
      const output = stripVTControlCharacters(renderToString(
        createElement(Box, { flexDirection: 'column' },
          createElement(Static, {
            items: [{ kind: 'tool', call: { name: 'bash', input: { command: 'pwd' } }, output: path, isError }],
            style: { width: '100%' },
          }, (item, key) => createElement(ItemView, { key, item, model: 'test' })),
          createElement(Text, null, '> prompt'),
        ),
        { columns },
      ));
      const lines = output.split('\n').filter(line => line.trim());
      assert.ok(lines.every(line => line.length <= columns), output);
      assert.equal(lines.at(-1), '> prompt');
      const body = lines.slice(1, -1);
      assert.ok(body[0].startsWith('  ⎿  '), output);
      assert.ok(body.slice(1).every(line => line.startsWith('     ')), output);
      assert.equal(body.map(line => line.slice(5)).join(''), path);
      assert.equal(body.length, Math.ceil(path.length / (columns - 5)), output);
    }
  });
}

for (const columns of [20, 40, 80]) {
  test(`sent prompts wrap within ${columns} columns with a fixed prefix`, () => {
    for (const text of [prompt, 'a'.repeat(150), 'a'.repeat(300), 'first line\nsecond line']) {
      const output = stripVTControlCharacters(renderToString(
        createElement(ItemView, { item: { kind: 'user', text }, model: 'test' }),
        { columns },
      ));
      const lines = output.split('\n').filter(line => line.trim());
      assert.ok(lines[0].startsWith('> '), output);
      assert.ok(lines.every(line => line.length <= columns), output);
      assert.ok(lines.slice(1).every(line => line.startsWith('  ')), output);
      assert.equal(lines.map(line => line.slice(2)).join('').replace(/\s/g, ''), previewPrompt(text).replace(/\s/g, ''));
    }
  });
}

for (const columns of [20, 40, 60, 80]) {
  test(`assistant history keeps styled paragraphs inside ${columns} columns`, () => {
    const text = 'Megacode has **permission dialogs**, but not a structured questionnaire form.\n'
      + 'Suggested next prompts are based on the **current conversation and work**, not history matching. '
      + 'Tab to accept and a config toggle.\n\nThis uses an additional model request when enabled.';
    for (const first of [true, false]) {
      const lines = renderItem({ kind: 'assistant', text, first }, columns);
      assert.ok(lines.every(line => line.length <= columns), lines.join('\n'));
      assert.ok(lines.slice(first ? 1 : 0).every(line => line.startsWith('  ')), lines.join('\n'));
      assert.equal(lines.map(line => line.slice(2)).join('').replace(/\s/g, ''), text.replace(/[\s*]/g, ''));
      assert.ok(!lines.some(line => /toggl$/.test(line)), lines.join('\n'));
    }
  });

  test(`tool output and notices retain their prefix at ${columns} columns`, () => {
    const text = 'Edited /a/very/long/path/to/the/project/test/ui.test.mjs (1 replacement)\nAnother line of output';
    const items = [
      { kind: 'tool', call: { name: 'edit_file', input: { path: 'test/ui.test.mjs' } }, output: text },
      { kind: 'notice', level: 'info', text },
    ];
    for (const item of items) {
      const lines = renderItem(item, columns);
      assert.ok(lines.every(line => line.length <= columns), lines.join('\n'));
      const body = lines.slice(lines.findIndex(line => line.startsWith('  ⎿  ')));
      assert.ok(body.length > 1);
      assert.ok(body.slice(1).every(line => line.startsWith('     ')), lines.join('\n'));
      assert.equal(body.map(line => line.slice(5)).join('').replace(/\s/g, ''), text.replace(/\s/g, ''));
    }
  });

  test(`diff continuations stay out of the line-number gutter at ${columns} columns`, () => {
    const code = "  const message = 'a lengthy string which should wrap within the code column';";
    const item = {
      kind: 'tool', call: { name: 'edit_file', input: { path: 'example.ts' } }, output: 'Added 1 line',
      diff: buildDiff({ file: 'example.ts', before: '', after: code + '\n' }),
    };
    const lines = renderItem(item, columns);
    assert.ok(lines.every(line => line.length <= columns), lines.join('\n'));
    // The band starts under the output (column 5); the code starts after " 1 +".
    const start = lines.findIndex(line => /^ {6}1 \+(?: |$)/.test(line));
    assert.ok(start >= 0, lines.join('\n'));
    const codeLines = lines.slice(start);
    assert.ok(codeLines.length > 1);
    assert.ok(codeLines.slice(1).every(line => line.startsWith(' '.repeat(9))), lines.join('\n'));
    assert.equal(codeLines.map(line => line.slice(9)).join('').replace(/\s/g, ''), code.replace(/\s/g, ''));
  });
}

const { StatusLine } = await import('../src/ui/prompt/StatusLine.tsx');
const { Select } = await import('../src/ui/components/Select.tsx');
const { Help } = await import('../src/ui/prompt/Help.tsx');
const { Dialog } = await import('../src/ui/components/Dialog.tsx');
// Trailing spaces are trimmed: with color on, colored bands keep their padding.
const view = (element, columns) => stripVTControlCharacters(renderToString(element, { columns })).split('\n').map((line) => line.trimEnd()).filter(Boolean);

test('status line keeps the mode whole and gives up the path before the details', (t) => {
  // A cwd too long for the row, wherever the repo is checked out.
  const home = process.cwd();
  const root = mkdtempSync(join(tmpdir(), 'status-line-'));
  const deep = join(root, 'a-directory-name-long-enough', 'that-the-path-cannot-fit');
  mkdirSync(deep, { recursive: true });
  process.chdir(deep);
  t.after(() => (process.chdir(home), rmSync(root, { recursive: true, force: true })));
  const props = { model: 'openai:gpt-6-astra', loggedIn: true, exitArmed: false, usage: { input: 12000, output: 3400 },  };
  const wide = view(createElement(StatusLine, { ...props, mode: 'ask' }), 100);
  assert.equal(wide.length, 1);
  assert.match(wide[0], /^ {2}ask mode ….*that-the-path-cannot-fit {2}openai:gpt-6-astra · 15\.4k tokens$/);
  for (const columns of [40, 50, 60]) {
    const narrow = view(createElement(StatusLine, { ...props, mode: 'ask' }), columns);
    assert.equal(narrow.length, 1, narrow.join('\n'));
    assert.ok(narrow[0].length <= columns, narrow[0]);
    assert.match(narrow[0], /^ {2}ask mode /, narrow[0]);
  }
});

test('status line shows context use and speed only when given', () => {
  const props = { mode: 'yolo', model: 'compat:bonsai', loggedIn: true, exitArmed: false, usage: { input: 12000, output: 3400 } };
  const line = (extra) => view(createElement(StatusLine, { ...props, ...extra }), 140)[0];
  assert.match(line({}), /compat:bonsai · 15\.4k tokens$/);
  assert.match(line({ context: { tokens: 13100, window: 131072 }, speed: 82.84 }), / · 13\.1k \(10%\) · 82\.8 tok\/s$/);
  assert.match(line({ context: { tokens: 950, window: null }, speed: null }), / · 15\.4k tokens · 950$/);
});

test('long options and help descriptions wrap under their own column', () => {
  const options = view(createElement(Select, { options: [{ label: 'No, and tell megacode what to do differently', value: 1 }], onSelect() {} }), 30);
  assert.ok(options.length > 1);
  assert.ok(options.slice(1).every((line) => line.startsWith('     ')), options.join('\n'));

  const help = view(createElement(Help), 50);
  const wrapped = help.findIndex((line) => line.includes('ctrl+s'));
  const column = help[wrapped].indexOf('send');
  assert.ok(help[wrapped + 1].slice(0, column).trim() === '', help.slice(wrapped, wrapped + 2).join('\n'));
});

test('dialogs share one layout: title, blank line, body, blank line, key hints', () => {
  const lines = stripVTControlCharacters(renderToString(
    createElement(Dialog, { title: 'Title', subtitle: 'context', footer: 'esc close' }, createElement(Text, null, 'Body')),
    { columns: 40 },
  )).split('\n');
  const inside = lines.slice(lines.findIndex((l) => l.startsWith('╭')) + 1, lines.findIndex((l) => l.startsWith('╰')));
  assert.deepEqual(inside.map((line) => line.replace(/^│ ?|\s*│$/g, '')), ['Title · context', '', 'Body', '', 'esc close']);
});

const { ApprovalDialog } = await import('../src/ui/dialogs/ApprovalDialog.tsx');

test('file changes are approved in Claude Code layout: title, path, the diff between dashed rules', () => {
  const approval = (change) => view(createElement(ApprovalDialog, { request: { tool: 'edit_file', title: 'Edit', change, resolve() {} }, onAnswer() {} }), 60);
  const edit = approval({ file: `${process.cwd()}/src/a.ts`, before: 'one\ntwo\n', after: 'one\nTWO\n' });
  assert.match(edit[0], /^─{60}$/);
  assert.deepEqual(edit.slice(1, 3), [' Edit file', ' src/a.ts']);
  assert.match(edit[3], /^╌{60}$/);
  assert.deepEqual(edit.slice(4, 7), [' 1  one', ' 2 -two', ' 2 +TWO']);
  assert.match(edit[7], /^╌{60}$/);
  assert.equal(edit[8], ' Do you want to make this edit to a.ts?');
  assert.match(edit.at(-1), /Esc to cancel/);

  const created = approval({ file: 'b.ts', before: '', after: 'const b = 1;\n', created: true });
  assert.equal(created[1], ' Create file');
  assert.ok(created.includes('  1 const b = 1;'), created.join('\n'));
  assert.ok(created.includes(' Do you want to create b.ts?'));
});
