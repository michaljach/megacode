import { useState } from "react";
import { openWorktree, removeWorktree, type Worktree } from "../../adapters/git/worktree.ts";
import type { Agent } from "../../core/agent.ts";

/** The git worktree the session works in, if any. Actions return a message to show and throw on git errors. */
export function useWorktree(agent: Agent, initial: Worktree | null, home: string) {
  const [worktree, setWorktree] = useState(initial);

  const moveTo = (dir: string) => {
    process.chdir(dir);
    agent.reloadSystemPrompt(); // the system prompt includes the working directory
  };

  return {
    worktree,

    /** Switches to the named worktree, creating it if needed; no name creates one with a random name. */
    enter(name?: string): string {
      const wt = openWorktree(name);
      moveTo(wt.path);
      setWorktree(wt);
      return `${wt.created ? "Created" : "Switched to"} worktree ${wt.name} on branch ${wt.branch} · ${wt.path}`;
    },

    /** Returns to `home`, optionally removing the worktree and its branch. */
    leave(remove: boolean): string {
      const wt = worktree!;
      moveTo(home);
      setWorktree(null);
      if (!remove) return `Kept worktree ${wt.name} at ${wt.path} (branch ${wt.branch}). Return with megacode -w ${wt.name}.`;
      removeWorktree(wt);
      return `Removed worktree ${wt.name} and branch ${wt.branch}.`;
    },
  };
}
