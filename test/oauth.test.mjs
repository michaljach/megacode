import assert from 'node:assert/strict';
import { test } from 'node:test';
import { callbackServer } from '../src/adapters/auth/oauth.ts';

test('OAuth error pages escape attacker-controlled HTML', async (t) => {
  const server = await callbackServer({ port: 0, path: '/callback', state: 'expected', signal: new AbortController().signal });
  t.after(() => server.close());
  const payload = `<script>alert("x")</script>&'`;
  const url = new URL(`http://127.0.0.1:${server.port}/callback`);
  url.searchParams.set('error_description', payload);
  const response = await fetch(url);
  assert.equal(response.status, 400);
  const html = await response.text();
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;'));
  await assert.rejects(server.code, { message: payload });
});

test('valid OAuth callbacks still return the authorization code', async (t) => {
  const server = await callbackServer({ port: 0, path: '/callback', state: 'expected', signal: new AbortController().signal });
  t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${server.port}/callback?code=example&state=expected`);
  assert.equal(response.status, 200);
  await response.text();
  assert.equal(await server.code, 'example');
});
