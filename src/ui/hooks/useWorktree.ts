import { useState } from "react";
import { openWorktree, removeWorktree, type Worktree } from "../../adapters/git/worktree.ts";

/** The git worktree the session works in, if any. Actions return a message to show and throw on git errors. */
export function useWorktree(initial: Worktree | null, home: string) {
  const [worktree, setWorktree] = useState(initial);

  return {
    worktree,

    /** Switches to the named worktree, creating it if needed; no name creates one with a random name. */
    async enter(name?: string): Promise<string> {
      const wt = await openWorktree(name);
      process.chdir(wt.path);
      setWorktree(wt);
      return `${wt.created ? "Created" : "Switched to"} worktree ${wt.name} on branch ${wt.branch} · ${wt.path}`;
    },

    /** Returns to `home`, optionally removing the worktree and its branch. */
    async leave(remove: boolean): Promise<string> {
      const wt = worktree!;
      process.chdir(home);
      setWorktree(null);
      if (!remove) return `Kept worktree ${wt.name} at ${wt.path} (branch ${wt.branch}). Return with megacode -w ${wt.name}.`;
      await removeWorktree(wt);
      return `Removed worktree ${wt.name} and branch ${wt.branch}.`;
    },
  };
}
