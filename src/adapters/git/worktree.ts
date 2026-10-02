import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadSettings } from "../settings.ts";

/** A git worktree megacode manages: <repo>/.megacode/worktrees/<name>, on branch worktree-<name>. */
export type Worktree = { name: string; path: string; branch: string; root: string };
export type WorktreeChanges = { files: number; commits: number };

export const WORKTREE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const tryGit = (cwd: string, ...args: string[]) => {
  try {
    return git(cwd, ...args);
  } catch {
    return null;
  }
};

/** Root of the main checkout, also when called from inside a worktree. */
export function mainRoot(cwd = process.cwd()): string {
  const common = tryGit(cwd, "rev-parse", "--path-format=absolute", "--git-common-dir");
  if (!common) throw new Error("Not a git repository; worktrees need git.");
  return path.dirname(common);
}

const worktreesDir = (root: string) => path.join(root, ".megacode", "worktrees");
const worktree = (root: string, name: string): Worktree => ({
  name,
  path: path.join(worktreesDir(root), name),
  branch: `worktree-${name}`,
  root,
});

/** Worktrees under .megacode/worktrees that git knows about. */
export function listWorktrees(cwd = process.cwd()): Worktree[] {
  const root = mainRoot(cwd);
  const dir = worktreesDir(root);
  if (!existsSync(dir)) return [];
  const real = realpathSync(dir);
  return git(root, "worktree", "list", "--porcelain")
    .split("\n")
    .filter((l) => l.startsWith("worktree "))
    .map((l) => l.slice("worktree ".length))
    .filter((p) => path.dirname(p) === real || path.dirname(p) === dir)
    .map((p) => worktree(root, path.basename(p)));
}

const ADJECTIVES = ["brisk", "calm", "clever", "eager", "gentle", "happy", "keen", "lucky", "nimble", "quiet", "swift", "witty"];
const NOUNS = ["badger", "comet", "falcon", "harbor", "lantern", "maple", "otter", "pebble", "river", "sparrow", "tiger", "willow"];
const pick = (list: string[]) => list[Math.floor(Math.random() * list.length)]!;

function randomName(root: string): string {
  for (;;) {
    const name = `${pick(ADJECTIVES)}-${pick(NOUNS)}-${Math.floor(Math.random() * 1000)}`;
    if (!existsSync(worktree(root, name).path)) return name;
  }
}

/** The commit new worktrees start from: the remote's default branch, or the current commit (see /config). */
export function baseRef(cwd = process.cwd()): string {
  if (loadSettings().worktreeBase === "fresh")
    for (const ref of ["origin/HEAD", "origin/main", "origin/master"])
      if (tryGit(cwd, "rev-parse", "--verify", "--quiet", `${ref}^{commit}`)) return ref;
  return "HEAD";
}

/** Opens the worktree with this name, creating it (and its branch) if needed. No name picks a random one. */
export function openWorktree(name?: string, cwd = process.cwd()): Worktree & { created: boolean } {
  const root = mainRoot(cwd);
  if (name !== undefined && !WORKTREE_NAME.test(name))
    throw new Error(`Invalid worktree name "${name}": use letters, digits, - and _ (max 64).`);
  const wt = worktree(root, name ?? randomName(root));
  if (listWorktrees(root).some((w) => w.name === wt.name)) return { ...wt, created: false };
  if (existsSync(wt.path)) throw new Error(`${wt.path} exists but isn't a git worktree; remove it or pick another name.`);

  // Keep worktrees out of the main checkout's `git status`.
  mkdirSync(worktreesDir(root), { recursive: true });
  const ignore = path.join(worktreesDir(root), ".gitignore");
  if (!existsSync(ignore)) writeFileSync(ignore, "*\n");

  // Reuse a branch left behind by an earlier worktree of the same name rather than resetting it.
  const branchExists = tryGit(root, "rev-parse", "--verify", "--quiet", `refs/heads/${wt.branch}`);
  const args = branchExists ? [wt.path, wt.branch] : ["-b", wt.branch, wt.path, baseRef(cwd)];
  try {
    git(root, "worktree", "add", ...args);
  } catch (e) {
    throw new Error(`git worktree add failed: ${(e as { stderr?: string }).stderr?.trim() || (e as Error).message}`);
  }
  return { ...wt, created: true };
}

/** Uncommitted files, and commits on the worktree's branch that no other branch or remote has. Null if git fails. */
export function worktreeChanges(wt: Worktree): WorktreeChanges | null {
  const status = tryGit(wt.path, "status", "--porcelain");
  const commits = tryGit(wt.path, "rev-list", "--count", "HEAD", "--not", `--exclude=${wt.branch}`, "--branches", "--remotes");
  if (status === null || commits === null) return null;
  return { files: status.split("\n").filter(Boolean).length, commits: Number(commits) };
}

export function describeChanges(c: WorktreeChanges | null): string {
  if (!c) return "status unknown";
  const parts = [];
  if (c.files) parts.push(`${c.files} changed file${c.files === 1 ? "" : "s"}`);
  if (c.commits) parts.push(`${c.commits} new commit${c.commits === 1 ? "" : "s"}`);
  return parts.join(", ") || "no changes";
}

/** Deletes the worktree directory (discarding uncommitted changes) and its branch. */
export function removeWorktree(wt: Worktree) {
  if (process.cwd() === wt.path || process.cwd().startsWith(wt.path + path.sep)) process.chdir(wt.root);
  try {
    git(wt.root, "worktree", "remove", "--force", wt.path);
  } catch (e) {
    throw new Error(`git worktree remove failed: ${(e as { stderr?: string }).stderr?.trim() || (e as Error).message}`);
  }
  tryGit(wt.root, "branch", "-D", wt.branch);
}
