export type Command = { name: string; description: string };

export const COMMANDS: Command[] = [
  { name: "/model", description: "Switch model (or /model provider:model)" },
  { name: "/login", description: "Connect a provider (API key or local server)" },
  { name: "/logout", description: "Remove saved credentials" },
  { name: "/config", description: "View and change settings" },
  { name: "/mcp", description: "Manage MCP servers (add, remove, reconnect, see tools)" },
  { name: "/worktree", description: "Create or switch git worktrees (or /worktree name)" },
  { name: "/clear", description: "Clear conversation history and screen" },
  { name: "/usage", description: "Fetch current provider's account usage and limits" },
  { name: "/help", description: "Show commands and keyboard shortcuts" },
  { name: "/exit", description: "Exit megacode" },
];

/** Hidden aliases: accepted, but not listed in the slash menu or help. */
const ALIASES = ["/quit", "/settings"];

export function isCommand(text: string): boolean {
  const name = text.split(/\s+/, 1)[0]!;
  return ALIASES.includes(name) || COMMANDS.some((command) => command.name === name);
}
