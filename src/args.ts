import { parseArgs } from "node:util";
import { WORKTREE_NAME } from "./adapters/git/worktree.ts";

type CliOptions = {
  model?: string;
  ask: boolean;
  help: boolean;
  /** -w was given; `name` is undefined for a random one. */
  worktree?: { name?: string };
  prompt: string;
};

/**
 * Parses command-line arguments. -w takes an optional name (`megacode -w`, `megacode -w fix-auth "prompt"`),
 * which parseArgs can't express: the next argument is the name if it looks like one, otherwise it's left for the prompt.
 */
export function parseCliArgs(argv: string[]): CliOptions {
  const args = [...argv];
  let worktree: CliOptions["worktree"];
  const wi = args.findIndex((a) => a === "-w" || a === "--worktree" || a.startsWith("--worktree="));
  if (wi !== -1) {
    const [flag] = args.splice(wi, 1);
    if (flag!.startsWith("--worktree=")) worktree = { name: flag!.slice("--worktree=".length) || undefined };
    else if (args[wi] !== undefined && WORKTREE_NAME.test(args[wi]!)) worktree = { name: args.splice(wi, 1)[0] };
    else worktree = {};
  }

  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      model: { type: "string", short: "m" },
      ask: { type: "boolean", short: "a" },
      help: { type: "boolean", short: "h" },
    },
  });
  return { model: values.model, ask: !!values.ask, help: !!values.help, worktree, prompt: positionals.join(" ") };
}
