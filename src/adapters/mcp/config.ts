import { readJson, writeJson } from "../storage.ts";

/** One server in ~/.megacode/mcp.json, in the same shape Claude Code and Claude Desktop use. */
export type McpServerConfig = (
  | { type?: "stdio"; command: string; args?: string[]; env?: Record<string, string> }
  | { type: "http" | "sse"; url: string; headers?: Record<string, string> }
) & { disabled?: boolean };

export type McpTransport = "stdio" | "http" | "sse";

type McpFile = { mcpServers?: Record<string, McpServerConfig> };

export const MCP_FILE = "mcp.json";
export const SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/;

export const loadServers = () => readJson<McpFile>(MCP_FILE, {}).mcpServers ?? {};

/** Writes the server list, keeping any other keys in the file. */
export function saveServers(servers: Record<string, McpServerConfig>) {
  writeJson(MCP_FILE, { ...readJson<McpFile>(MCP_FILE, {}), mcpServers: servers });
}

export const transportOf = (c: McpServerConfig): McpTransport => ("url" in c ? c.type : "stdio");
export const describeServer = (c: McpServerConfig) => ("url" in c ? c.url : [c.command, ...(c.args ?? [])].join(" "));

/** A server as entered in the /mcp add wizard. */
export type ServerDraft = { type: McpTransport; target: string; extras: Record<string, string> };

/** Draft → config: `target` is a URL for http/sse, else a command line; `extras` are headers or env vars. */
export function draftToConfig({ type, target, extras }: ServerDraft): McpServerConfig {
  const hasExtras = Object.keys(extras).length > 0;
  if (type !== "stdio") return { type, url: target, ...(hasExtras ? { headers: extras } : {}) };
  const [command, ...args] = splitCommand(target);
  return { command: command!, args, ...(hasExtras ? { env: extras } : {}) };
}

/** Parses "Name: value" (a header) or "KEY=value" (an env var). Null if malformed. */
export function parseExtra(type: McpTransport, line: string): [key: string, value: string] | null {
  const m = type === "stdio" ? line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s) : line.match(/^([^:\s]+):\s*(.+)$/);
  return m ? [m[1]!, m[2]!] : null;
}

export function isHttpUrl(text: string): boolean {
  try {
    return /^https?:$/.test(new URL(text).protocol);
  } catch {
    return false;
  }
}

/** Splits a command line into words, honoring single and double quotes. */
export function splitCommand(line: string): string[] {
  const words: string[] = [];
  let word: string | null = null;
  let quote: string | null = null;
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = null;
      else word += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      word ??= "";
    } else if (/\s/.test(ch)) {
      if (word !== null) words.push(word);
      word = null;
    } else word = (word ?? "") + ch;
  }
  if (word !== null) words.push(word);
  return words;
}
