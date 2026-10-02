import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { executeTool } from '../src/tools.ts';
import { loadSettings } from '../src/config.ts';

const allow = async () => true;
const execute = (name, input, approve = allow, signal) => executeTool({ id: 'test', name, input }, approve, signal);
const shellQuote = (s) => `'${s.replaceAll("'", "'\\''")}'`;
const nodeCommand = (script) => `${shellQuote(process.execPath)} -e ${shellQuote(script)}`;

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'megacode-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'file.txt');
  await writeFile(file, 'original\n');
  return file;
}

test('rejects malformed arguments without throwing or requesting approval', async () => {
  for (const input of [null, undefined, 1, true, 'text', [], {}, { path: 2, content: 'x' }, { path: 'x', content: null }, { _invalid_json: '{' }]) {
    const result = await execute('write_file', input, async () => assert.fail('unexpected approval'));
    assert.equal(result.isError, true);
  }
  for (const offset of [0, -1, 1.5, NaN, Infinity, '1']) {
    assert.equal((await execute('read_file', { path: 'unused', offset })).isError, true);
  }
  assert.equal((await execute('edit_file', { path: 'unused', old_string: '', new_string: 'x' })).isError, true);
  assert.equal((await execute('edit_file', { path: 'unused', old_string: 'x', new_string: 'y', replace_all: 'yes' })).isError, true);
  assert.equal((await execute('unknown', {})).isError, true);
});

test('does not overwrite changes made during approval', async (t) => {
  const file = await fixture(t);
  const result = await execute('edit_file', { path: file, old_string: 'original', new_string: 'agent' }, async () => {
    await writeFile(file, 'user changes\n');
    return true;
  });
  assert.equal(result.isError, true);
  assert.match(result.output, /File changed/);
  assert.equal(await readFile(file, 'utf8'), 'user changes\n');
});

test('normal edits preserve literal replacement strings and support replace_all', async (t) => {
  const file = await fixture(t);
  assert.equal((await execute('edit_file', { path: file, old_string: 'original', new_string: '$&' })).isError, false);
  assert.equal(await readFile(file, 'utf8'), '$&\n');
  await writeFile(file, 'a a');
  assert.equal((await execute('edit_file', { path: file, old_string: 'a', new_string: 'b' })).isError, true);
  assert.equal((await execute('edit_file', { path: file, old_string: 'a', new_string: 'b', replace_all: true })).isError, false);
  assert.equal(await readFile(file, 'utf8'), 'b b');
});

test('denying an edit leaves the file unchanged', async (t) => {
  const file = await fixture(t);
  await execute('edit_file', { path: file, old_string: 'original', new_string: 'agent' }, async () => false);
  assert.equal(await readFile(file, 'utf8'), 'original\n');
});

test('shell exit status is reflected in tool results', async () => {
  assert.deepEqual(await execute('bash', { command: 'exit 7' }), { output: '[exit code 7]', isError: true });
  assert.deepEqual(await execute('bash', { command: 'exit 0' }), { output: '(no output)', isError: false });
  const missing = await execute('bash', { command: 'megacode_nonexistent_command_12345' });
  assert.equal(missing.isError, true);
});

test('shell output is bounded and both streams are drained', async () => {
  const max = loadSettings().maxToolOutput;
  const count = max + 100_000;
  const result = await execute('bash', { command: nodeCommand(`process.stdout.write('a'.repeat(${count})); process.stderr.write('b'.repeat(${count}));`) });
  assert.equal(result.isError, false);
  assert.ok(result.output.length < max + 100);
  assert.match(result.output, new RegExp(`truncated ${2 * count - max} chars`));
});

test('timeout and aborted commands report errors', async () => {
  const result = await execute('bash', { command: nodeCommand('setInterval(() => {}, 1000)'), timeout_ms: 50 });
  assert.equal(result.isError, true);
  const ctrl = new AbortController();
  ctrl.abort();
  assert.equal((await execute('bash', { command: 'exit 0' }, allow, ctrl.signal)).isError, true);
});

test('grep treats no matches as success and invalid regex as failure', async (t) => {
  const file = await fixture(t);
  assert.deepEqual(await execute('grep', { pattern: 'absent', path: file }), { output: 'No matches.', isError: false });
  assert.equal((await execute('grep', { pattern: '[', path: file })).isError, true);
  const match = await execute('grep', { pattern: 'original', path: file });
  assert.equal(match.isError, false);
  assert.match(match.output, /original/);
});
