import { execFile } from "node:child_process";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { pathExists } from "../../lib/fs.ts";
import { plural } from "../../lib/plural.ts";
import { loadSettings } from "../settings.ts";

/** A git worktree megacode manages: <repo>/.megacode/worktrees/<name>, on branch worktree-<name>. */
export type Worktree = { name: string; path: string; branch: string; root: string };
export type WorktreeChanges = { files: number; commits: number };

export const WORKTREE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

const execGit = promisify(execFile);

// Async so a slow git (large repo, network filesystem) never freezes the UI. Failures carry git's own message.
async function git(cwd: string, ...args: string[]): Promise<string> {
  try {
    return (await execGit("git", args, { cwd, encoding: "utf8" })).stdout.trim();
  } catch (e) {
    throw new Error(`git ${args.slice(0, 2).join(" ")} failed: ${(e as { stderr?: string }).stderr?.trim() || (e as Error).message}`);
  }
}

const tryGit = (cwd: string, ...args: string[]) => git(cwd, ...args).catch(() => null);

/** Root of the main checkout, also when called from inside a worktree. */
export async function mainRoot(cwd = process.cwd()): Promise<string> {
  const common = await tryGit(cwd, "rev-parse", "--path-format=absolute", "--git-common-dir");
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
export async function listWorktrees(cwd = process.cwd()): Promise<Worktree[]> {
  const root = await mainRoot(cwd);
  const dir = worktreesDir(root);
  const real = await realpath(dir).catch(() => null);
  if (!real) return [];
  return (await git(root, "worktree", "list", "--porcelain"))
    .split("\n")
    .filter((l) => l.startsWith("worktree "))
    .map((l) => l.slice("worktree ".length))
    .filter((p) => path.dirname(p) === real || path.dirname(p) === dir)
    .map((p) => worktree(root, path.basename(p)));
}

const ADJECTIVES = ["brisk", "calm", "clever", "eager", "gentle", "happy", "keen", "lucky", "nimble", "quiet", "swift", "witty"];
const NOUNS = ["badger", "comet", "falcon", "harbor", "lantern", "maple", "otter", "pebble", "river", "sparrow", "tiger", "willow"];
const pick = (list: string[]) => list[Math.floor(Math.random() * list.length)]!;

async function randomName(root: string): Promise<string> {
  for (;;) {
    const name = `${pick(ADJECTIVES)}-${pick(NOUNS)}-${Math.floor(Math.random() * 1000)}`;
    if (!(await pathExists(worktree(root, name).path))) return name;
  }
}

/** The commit new worktrees start from: the remote's default branch, or the current commit (see /config). */
export async function baseRef(cwd = process.cwd()): Promise<string> {
  if (loadSettings().worktreeBase === "fresh")
    for (const ref of ["origin/HEAD", "origin/main", "origin/master"])
      if (await tryGit(cwd, "rev-parse", "--verify", "--quiet", `${ref}^{commit}`)) return ref;
  return "HEAD";
}

/** Opens the worktree with this name, creating it (and its branch) if needed. No name picks a random one. */
export async function openWorktree(name?: string, cwd = process.cwd()): Promise<Worktree & { created: boolean }> {
  const root = await mainRoot(cwd);
  if (name !== undefined && !WORKTREE_NAME.test(name))
    throw new Error(`Invalid worktree name "${name}": use letters, digits, - and _ (max 64).`);
  const wt = worktree(root, name ?? (await randomName(root)));
  if ((await listWorktrees(root)).some((w) => w.name === wt.name)) return { ...wt, created: false };
  if (await pathExists(wt.path)) throw new Error(`${wt.path} exists but isn't a git worktree; remove it or pick another name.`);

  // Keep worktrees out of the main checkout's `git status`.
  await mkdir(worktreesDir(root), { recursive: true });
  const ignore = path.join(worktreesDir(root), ".gitignore");
  if (!(await pathExists(ignore))) await writeFile(ignore, "*\n");

  // Reuse a branch left behind by an earlier worktree of the same name rather than resetting it.
  const branchExists = await tryGit(root, "rev-parse", "--verify", "--quiet", `refs/heads/${wt.branch}`);
  const args = branchExists ? [wt.path, wt.branch] : ["-b", wt.branch, wt.path, await baseRef(cwd)];
  await git(root, "worktree", "add", ...args);
  return { ...wt, created: true };
}

/** Uncommitted files, and commits on the worktree's branch that no other branch or remote has. Null if git fails. */
export async function worktreeChanges(wt: Worktree): Promise<WorktreeChanges | null> {
  const [status, commits] = await Promise.all([
    tryGit(wt.path, "status", "--porcelain"),
    tryGit(wt.path, "rev-list", "--count", "HEAD", "--not", `--exclude=${wt.branch}`, "--branches", "--remotes"),
  ]);
  if (status === null || commits === null) return null;
  return { files: status.split("\n").filter(Boolean).length, commits: Number(commits) };
}

export function describeChanges(c: WorktreeChanges | null): string {
  if (!c) return "status unknown";
  const parts = [c.files && plural(c.files, "changed file"), c.commits && plural(c.commits, "new commit")];
  return parts.filter(Boolean).join(", ") || "no changes";
}

/** Deletes the worktree directory (discarding uncommitted changes) and its branch. */
export async function removeWorktree(wt: Worktree) {
  if (process.cwd() === wt.path || process.cwd().startsWith(wt.path + path.sep)) process.chdir(wt.root);
  await git(wt.root, "worktree", "remove", "--force", wt.path);
  await tryGit(wt.root, "branch", "-D", wt.branch);
}
