import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Keep ~/.megacode/mcp.json untouched: config paths are computed from HOME at import time.
process.env.HOME = mkdtempSync(path.join(os.tmpdir(), 'megacode-mcp-home-'));
const { mcp } = await import('../src/adapters/mcp/manager.ts');
const { splitCommand } = await import('../src/adapters/mcp/config.ts');

const server = { command: process.execPath, args: [path.join(import.meta.dirname, 'fixtures', 'mcp-echo-server.mjs')] };
const allow = async () => true;
const call = (name, input, approve = allow) => mcp.execute({ id: 't', name, input }, { approve });
const saved = () => JSON.parse(readFileSync(path.join(process.env.HOME, '.megacode', 'mcp.json'), 'utf8')).mcpServers;

test.after(() => mcp.closeAll());

test('connects a stdio server and exposes its tools with provider-safe names', async () => {
  const status = await mcp.add('echo', { ...server, env: { SECRET: 'shh' } });
  assert.equal(status.state, 'connected', status.error);
  assert.deepEqual(saved().echo, { ...server, env: { SECRET: 'shh' } });
  assert.deepEqual(mcp.specs().map((t) => t.name).sort(), ['mcp__echo__echo', 'mcp__echo__env_read', 'mcp__echo__fail']);
  assert.equal(mcp.specs().find((t) => t.name === 'mcp__echo__echo').parameters.type, 'object');
  assert.match(mcp.instructions(), /Use echo to repeat text/);
});

test('calls tools after approval and reports errors and denials', async () => {
  assert.deepEqual(await call('mcp__echo__echo', { text: 'hi' }), { output: 'echo: hi', isError: false });
  assert.deepEqual(await call('mcp__echo__fail', {}), { output: 'it broke', isError: true });
  assert.deepEqual(await call('mcp__echo__env_read', { name: 'SECRET' }), { output: 'shh', isError: false });
  let asked;
  const denied = await call('mcp__echo__echo', { text: 'no' }, async (req) => ((asked = req), false));
  assert.equal(denied.output, 'User denied the tool call.');
  assert.equal(asked.tool, 'mcp__echo__echo');
  assert.match(asked.title, /echo · echo/);
});

test('disable, enable and remove update the file and the tool list', async () => {
  await mcp.setEnabled('echo', false);
  assert.equal(saved().echo.disabled, true);
  assert.equal(mcp.has('mcp__echo__echo'), false);
  await mcp.setEnabled('echo', true);
  assert.equal(saved().echo.disabled, undefined);
  assert.equal(mcp.has('mcp__echo__echo'), true);
  await mcp.remove('echo');
  assert.deepEqual(saved(), {});
  assert.deepEqual(mcp.servers(), []);
});

test('reports servers that fail to start', async () => {
  const status = await mcp.add('broken', { command: process.execPath, args: ['-e', 'console.error("missing API key"); process.exit(1)'] });
  assert.equal(status.state, 'failed');
  assert.match(status.error, /missing API key/);
  await mcp.remove('broken');
});

test('splits command lines with quotes', () => {
  assert.deepEqual(splitCommand(`npx -y "@scope/pkg" --dir '/a b' x""`), ['npx', '-y', '@scope/pkg', '--dir', '/a b', 'x']);
});
