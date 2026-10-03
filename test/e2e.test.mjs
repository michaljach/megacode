// End to end: the real CLI in one-shot mode against a fake OpenAI-compatible server.
// Covers argument handling, provider wiring, the agent loop, the built-in tools and plain output.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { lastMessage, startFakeOpenAI } from './fixtures/fake-openai.mjs';

const CLI = fileURLToPath(new URL('../src/cli.tsx', import.meta.url));
const TSX = import.meta.resolve('tsx');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64');

/**
 * Runs megacode against `server` in a fresh workspace (seeded with `files`) and a fresh config
 * folder (seeded with `settings`). Never touches ~/.megacode.
 */
async function megacode(t, server, args, { files = {}, settings } = {}) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'megacode-e2e-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const configDir = path.join(cwd, '.config');
  await mkdir(configDir);
  if (settings) await writeFile(path.join(configDir, 'settings.json'), JSON.stringify(settings));
  for (const [name, content] of Object.entries(files)) await writeFile(path.join(cwd, name), content);

  const env = { ...process.env, MEGACODE_CONFIG_DIR: configDir, OPENAI_COMPAT_BASE_URL: server.url };
  for (const key of ['MEGACODE_MODEL', 'OPENAI_COMPAT_API_KEY']) delete env[key];
  const child = spawn(process.execPath, ['--import', TSX, CLI, '-m', 'compat:fake', ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (d) => (stdout += d));
  child.stderr.setEncoding('utf8').on('data', (d) => (stderr += d));
  const code = await new Promise((resolve) => child.on('close', resolve));
  return { code, stdout, stderr, cwd };
}

/** Starts a fake server and stops it when the test ends. */
async function fakeModel(t, respond) {
  const server = await startFakeOpenAI(respond);
  t.after(server.close);
  return server;
}

test('runs tools end to end and feeds their results back to the model', async (t) => {
  const server = await fakeModel(t, (_, i) => [
    { toolCalls: [{ name: 'write_file', args: { path: 'notes.txt', content: 'alpha\nbeta\n' } }] },
    { toolCalls: [{ name: 'edit_file', args: { path: 'notes.txt', old_string: 'beta', new_string: 'BETA' } }] },
    { toolCalls: [{ name: 'bash', args: { command: 'cat notes.txt' } }] },
    { text: 'all done' },
  ][i]);
  const run = await megacode(t, server, ['update the notes']);

  assert.equal(run.code, 0, run.stderr);
  assert.equal(await readFile(path.join(run.cwd, 'notes.txt'), 'utf8'), 'alpha\nBETA\n');
  assert.match(run.stdout, /Write\(notes\.txt\)[\s\S]*Update\(notes\.txt\)[\s\S]*Bash\(cat notes\.txt\)[\s\S]*all done/);
  assert.equal(server.requests.length, 4);
  assert.equal(lastMessage(server.requests[0]).content, 'update the notes');
  assert.deepEqual(lastMessage(server.requests[3]), { role: 'tool', tool_call_id: 'call_3_0', content: 'alpha\nBETA' });
});

test('--ask without a terminal denies instead of running', async (t) => {
  const server = await fakeModel(t, (_, i) => [{ toolCalls: [{ name: 'bash', args: { command: 'touch ran' } }] }, { text: 'ok' }][i]);
  const run = await megacode(t, server, ['-a', 'make a file']);

  assert.equal(run.code, 0, run.stderr);
  assert.equal(existsSync(path.join(run.cwd, 'ran')), false);
  assert.equal(lastMessage(server.requests[1]).content, 'User denied the command.');
});

test('an image the model rejects is dropped and the turn continues', async (t) => {
  const hasImage = (body) => body.messages.some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'image_url'));
  const server = await fakeModel(t, (body, i) => {
    if (hasImage(body)) return { status: 400, error: { message: 'Invalid image.', type: 'invalid_request_error' } };
    return i === 0 ? { toolCalls: [{ name: 'view_image', args: { path: 'shot.png' } }] } : { text: 'could not see it' };
  });
  const run = await megacode(t, server, ['look at shot.png'], { files: { 'shot.png': PNG } });

  assert.equal(run.code, 0, run.stderr);
  assert.match(run.stdout, /removed from the conversation[\s\S]*could not see it/);
  assert.deepEqual(server.requests.map(hasImage), [false, true, false]);
  assert.match(lastMessage(server.requests[2]).content, /^Image: .*shot\.png .*\n\[Image not sent: the model rejected it\.\]$/);
});

test('a model that rejects reasoning_effort still answers, and later turns skip it', async (t) => {
  const server = await fakeModel(t, (body, i) => {
    if (body.reasoning_effort)
      return { status: 400, error: { message: "Unsupported parameter: 'reasoning_effort'", type: 'invalid_request_error', param: 'reasoning_effort' } };
    return i < 2 ? { toolCalls: [{ name: 'bash', args: { command: 'true' } }] } : { text: 'answered' };
  });
  const run = await megacode(t, server, ['hi'], { settings: { effort: 'high' } });

  assert.equal(run.code, 0, run.stderr);
  assert.match(run.stdout, /answered/);
  assert.deepEqual(server.requests.map((r) => r.reasoning_effort), ['high', undefined, undefined]);
});

test('rejected credentials end the run with an error', async (t) => {
  const server = await fakeModel(t, () => ({ status: 401, error: { message: 'Incorrect API key provided.', type: 'invalid_request_error' } }));
  const run = await megacode(t, server, ['hi']);

  assert.equal(run.code, 1);
  assert.match(run.stderr, /401 Incorrect API key/);
  assert.equal(server.requests.length, 1); // 401s aren't retried
});
