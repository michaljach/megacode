import { savedProviders } from "../adapters/auth/store.ts";
import { runSkillsCommand } from "../adapters/skills.ts";
import { mainRoot } from "../adapters/git/worktree.ts";
import { PROVIDERS, providerInfo } from "../adapters/providers/catalog.ts";
import { providerOf } from "../adapters/providers/credentials.ts";
import { providerUsage } from "../adapters/providers/usage.ts";
import type { NoticeLevel } from "../core/agent.ts";
import { EFFORTS, type Effort } from "../core/provider.ts";

/** Dialogs a command can open; App renders the active one. */
export type Dialog =
  | { type: "model"; query?: string }
  | { type: "login"; provider?: string; welcome?: boolean }
  | { type: "logout" }
  | { type: "config" }
  | { type: "effort" }
  | { type: "worktree" }
  | { type: "mcp" }
  | { type: "exit-worktree" };

/** What commands may do to the session. App implements it. */
export type CommandContext = {
  model: string;
  running: boolean;
  notice(text: string, level?: NoticeLevel): void;
  /** Prominent, undimmed output, e.g. a report the user asked for. */
  print(text: string): void;
  open(dialog: Dialog): void;
  showHelp(): void;
  clear(): void;
  quit(): void;
  selectModel(spec: string): void;
  selectEffort(effort: Effort): void;
  enterWorktree(name: string): void;
  logout(provider: string): void;
};

export type Command = {
  name: string;
  description: string;
  /** Accepted, but not listed in the slash menu or help. */
  aliases?: string[];
  run(ctx: CommandContext, arg: string): void;
};

export const COMMANDS: Command[] = [
  {
    name: "/skills",
    description: "List skills or install <local-directory|owner/repo|GitHub-URL> [--global]",
    run(ctx, arg) {
      if (ctx.running) return ctx.notice("Can't manage skills while a turn is running (esc to interrupt).", "warn");
      // Preserve spaces in a source path; the only supported option is a trailing --global.
      const match = /^install\s+(.+?)(\s+--global)?$/.exec(arg);
      const source = match?.[1].replace(/^([\"'])(.*)\1$/, "$2");
      const args = match ? ["install", source!, ...(match[2] ? ["--global"] : [])] : arg ? [arg] : [];
      if (match) ctx.notice("Installing skills…");
      runSkillsCommand(args, { cwd: process.cwd() }).then(ctx.print, (error: unknown) =>
        ctx.notice(error instanceof Error ? error.message : String(error), "error"),
      );
    },
  },
  {
    name: "/model",
    description: "Switch model (or /model provider:model)",
    run: (ctx, arg) => (arg ? ctx.selectModel(arg) : ctx.open({ type: "model" })),
  },
  {
    name: "/effort",
    description: "Change model effort (default, low, medium, high)",
    run(ctx, arg) {
      if (!arg) return ctx.open({ type: "effort" });
      if (!EFFORTS.includes(arg as Effort)) return ctx.notice(`Unknown effort "${arg}". Available: ${EFFORTS.join(", ")}`, "warn");
      ctx.selectEffort(arg as Effort);
    },
  },
  {
    name: "/login",
    description: "Connect a provider (API key or local server)",
    run(ctx, arg) {
      if (arg && !PROVIDERS.includes(arg)) return ctx.notice(`Unknown provider "${arg}". Available: ${PROVIDERS.join(", ")}`, "warn");
      ctx.open({ type: "login", provider: arg || undefined });
    },
  },
  {
    name: "/logout",
    description: "Remove saved credentials",
    run(ctx, arg) {
      if (arg) return ctx.logout(arg);
      if (!savedProviders().length) return ctx.notice("No saved credentials. (Keys from environment variables aren't stored by megacode.)");
      ctx.open({ type: "logout" });
    },
  },
  {
    name: "/config",
    description: "View and change settings",
    aliases: ["/settings"],
    run: (ctx) => ctx.open({ type: "config" }),
  },
  {
    name: "/mcp",
    description: "Manage MCP servers (add, remove, reconnect, see tools)",
    run: (ctx) => ctx.open({ type: "mcp" }),
  },
  {
    name: "/worktree",
    description: "Create or switch git worktrees (or /worktree name)",
    run(ctx, arg) {
      if (arg) return ctx.enterWorktree(arg);
      mainRoot().then(
        () => ctx.open({ type: "worktree" }),
        (e: Error) => ctx.notice(e.message, "warn"),
      );
    },
  },
  {
    name: "/clear",
    description: "Clear conversation history and screen",
    run(ctx) {
      if (ctx.running) return ctx.notice("Can't clear while a turn is running (esc to interrupt).", "warn");
      ctx.clear();
    },
  },
  {
    name: "/usage",
    description: "Fetch current provider's account usage and limits",
    run(ctx) {
      const provider = providerOf(ctx.model);
      const { label } = providerInfo(provider);
      ctx.notice(`Fetching ${label} usage…`);
      providerUsage(provider).then(ctx.print, (error: unknown) =>
        ctx.notice(`${label}: ${error instanceof Error ? error.message : "Unable to fetch usage."}`, "error"),
      );
    },
  },
  { name: "/help", description: "Show commands and keyboard shortcuts", run: (ctx) => ctx.showHelp() },
  { name: "/exit", description: "Exit megacode", aliases: ["/quit"], run: (ctx) => ctx.quit() },
];

const parse = (input: string) => {
  const [name = "", ...args] = input.trim().split(/\s+/);
  return { name, arg: args.join(" ") };
};

const byName = (name: string) => COMMANDS.find((c) => c.name === name || c.aliases?.includes(name));

/** Whether the text is a known slash command (with or without arguments). */
export const isCommand = (text: string) => !!byName(parse(text).name);

/** Runs a slash command line such as "/model openai:gpt-5". */
export function runCommand(input: string, ctx: CommandContext) {
  const { name, arg } = parse(input);
  const command = byName(name);
  if (!command) return ctx.notice(`Unknown command ${name}. Type / to see commands.`, "warn");
  command.run(ctx, arg);
}
