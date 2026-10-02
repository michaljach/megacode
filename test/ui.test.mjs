import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stripVTControlCharacters } from 'node:util';
import { createElement } from 'react';
import { renderToString } from 'ink';
import { ItemView } from '../src/ui/App.tsx';
import { previewPrompt } from '../src/ui/format.ts';

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
