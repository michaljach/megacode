import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { listWorktrees, openWorktree, removeWorktree, worktreeChanges } from '../src/adapters/git/worktree.ts';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

async function repo(t) {
  const dir = realpathSync(await mkdtemp(path.join(os.tmpdir(), 'megacode-wt-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'test');
  writeFileSync(path.join(dir, 'a.txt'), 'a\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'init');
  return dir;
}

test('creates a worktree on its own branch, hidden from the main checkout', async (t) => {
  const dir = await repo(t);
  const wt = await openWorktree('feature', dir);
  assert.equal(wt.created, true);
  assert.equal(wt.path, path.join(dir, '.megacode', 'worktrees', 'feature'));
  assert.equal(git(wt.path, 'branch', '--show-current'), 'worktree-feature');
  assert.equal(git(wt.path, 'rev-parse', 'HEAD'), git(dir, 'rev-parse', 'HEAD'));
  assert.equal(git(dir, 'status', '--porcelain'), '');
  assert.deepEqual((await listWorktrees(dir)).map((w) => w.name), ['feature']);
  assert.equal((await openWorktree('feature', dir)).created, false);
  assert.deepEqual(await worktreeChanges(wt), { files: 0, commits: 0 });
});

test('picks a random name when none is given and rejects invalid names', async (t) => {
  const dir = await repo(t);
  assert.match((await openWorktree(undefined, dir)).name, /^[a-z]+-[a-z]+-\d+$/);
  await assert.rejects(openWorktree('../escape', dir), /Invalid worktree name/);
  await assert.rejects(openWorktree('x', os.tmpdir()), /Not a git repository/);
});

test('counts uncommitted files and new commits, then removes worktree and branch', async (t) => {
  const dir = await repo(t);
  const wt = await openWorktree('work', dir);
  writeFileSync(path.join(wt.path, 'b.txt'), 'b\n');
  writeFileSync(path.join(wt.path, 'c.txt'), 'c\n');
  assert.deepEqual(await worktreeChanges(wt), { files: 2, commits: 0 });
  git(wt.path, 'add', 'b.txt');
  git(wt.path, 'commit', '-qm', 'b');
  assert.deepEqual(await worktreeChanges(wt), { files: 1, commits: 1 });

  await removeWorktree(wt);
  assert.equal(existsSync(wt.path), false);
  assert.equal(git(dir, 'branch', '--list', 'worktree-work'), '');
  assert.deepEqual((await listWorktrees(dir)), []);
});

test('reuses a branch left behind by an earlier worktree instead of resetting it', async (t) => {
  const dir = await repo(t);
  const wt = await openWorktree('again', dir);
  writeFileSync(path.join(wt.path, 'b.txt'), 'b\n');
  git(wt.path, 'add', '.');
  git(wt.path, 'commit', '-qm', 'b');
  const head = git(wt.path, 'rev-parse', 'HEAD');
  git(dir, 'worktree', 'remove', wt.path);
  assert.equal(git((await openWorktree('again', dir)).path, 'rev-parse', 'HEAD'), head);
});
