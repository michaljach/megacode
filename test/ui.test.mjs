import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stripVTControlCharacters } from 'node:util';
import { createElement } from 'react';
import { Box, Static, Text, renderToString } from 'ink';
import { ItemView } from '../src/ui/App.tsx';
import { previewPrompt } from '../src/ui/format.ts';

const prompt = 'make benchamrk table better to visualise codex vs megacode and possibly other in future';

for (const columns of [20, 40, 57, 80]) {
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
