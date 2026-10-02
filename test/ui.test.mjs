import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stripVTControlCharacters } from 'node:util';
import { createElement } from 'react';
import { Box, Static, Text, renderToString } from 'ink';
import { ItemView } from '../src/ui/Transcript.tsx';
import { previewPrompt } from '../src/ui/format.ts';
import { renderFileChange } from '../src/ui/code.ts';
import { PromptInput } from '../src/ui/PromptInput.tsx';
import { Questionnaire } from '../src/ui/Questionnaire.tsx';

test('questionnaire renders choices, custom answers, and progress', () => {
  const view = (questions) => stripVTControlCharacters(renderToString(createElement(Questionnaire, {
    questions, onSubmit() {}, onCancel() {},
  }), { columns: 80 }));
  const choices = view([{ question: 'Which framework?', options: ['React', 'Vue'] }, { question: 'Constraints?' }]);
  assert.match(choices, /Question 1 of 2/);
  assert.match(choices, /Which framework\?/);
  assert.match(choices, /React/);
  assert.match(choices, /Other — type an answer/);
  assert.match(choices, /Esc to cancel/);
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
      kind: 'tool', call: { name: 'edit_file', input: { path: 'example.ts' } }, output: 'Edited',
      changePreview: renderFileChange('example.ts', '', code + '\n'),
    };
    const lines = renderItem(item, columns);
    assert.ok(lines.every(line => line.length <= columns), lines.join('\n'));
    const start = lines.findIndex(line => /^ {13}1 \+(?: |$)/.test(line));
    assert.ok(start >= 0, lines.join('\n'));
    const codeLines = lines.slice(start);
    assert.ok(codeLines.length > 1);
    assert.ok(codeLines.slice(1).every(line => line.startsWith(' '.repeat(17))), lines.join('\n'));
    assert.equal(codeLines.map(line => line.slice(17)).join('').replace(/\s/g, ''), code.replace(/\s/g, ''));
  });
}
