import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stripVTControlCharacters } from 'node:util';
import { createElement } from 'react';
import { renderToString } from 'ink';
import { ItemView } from '../src/ui/App.tsx';
import { previewPrompt } from '../src/ui/format.ts';
import { renderFileChange } from '../src/code.ts';

const renderItem = (item, columns) => stripVTControlCharacters(renderToString(
  createElement(ItemView, { item, model: 'test' }), { columns },
)).split('\n').filter(line => line.trim());

const prompt = 'make benchamrk table better to visualise codex vs megacode and possibly other in future';

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
