import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { readJson, writeJson } from "./config.ts";
import { compactOutput, type Approve } from "./tools.ts";
import type { ToolCall, ToolSpec } from "./types.ts";

/** One server in ~/.megacode/mcp.json, in the same shape Claude Code and Claude Desktop use. */
export type McpServerConfig = (
  | { type?: "stdio"; command: string; args?: string[]; env?: Record<string, string> }
  | { type: "http" | "sse"; url: string; headers?: Record<string, string> }
) & { disabled?: boolean };
type McpFile = { mcpServers?: Record<string, McpServerConfig> };

export type McpTool = { name: string; server: string; tool: string; description: string; parameters: ToolSpec["parameters"] };
export type McpStatus =
  | { state: "disabled" }
  | { state: "connecting" }
  | { state: "connected"; tools: McpTool[]; instructions?: string }
  | { state: "failed"; error: string };
export type McpServer = { name: string; config: McpServerConfig; status: McpStatus };

export const MCP_FILE = "mcp.json";
export const SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/;
const CONNECT_TIMEOUT = 30_000;
const CALL_TIMEOUT = 10 * 60_000;

/** Tool names must match ^[A-Za-z0-9_-]{1,64}$ for every provider. */
const toolName = (server: string, tool: string) => `mcp__${server}__${tool.replace(/[^A-Za-z0-9_-]/g, "_")}`.slice(0, 64);

export const transportOf = (c: McpServerConfig) => ("url" in c ? c.type : "stdio");
export const describeServer = (c: McpServerConfig) => ("url" in c ? c.url : [c.command, ...(c.args ?? [])].join(" "));

type Connection = { client: Client; transport: Transport; stderr: string };

class McpManager {
  private status = new Map<string, McpStatus>();
  private connections = new Map<string, Connection>();
  private generation = new Map<string, number>(); // ignore events from superseded connections
  private listeners = new Set<() => void>();

  private load = () => readJson<McpFile>(MCP_FILE, {}).mcpServers ?? {};
  private save(servers: Record<string, McpServerConfig>) {
    writeJson(MCP_FILE, { ...readJson<McpFile>(MCP_FILE, {}), mcpServers: servers });
  }

  /** Re-render hook for the UI. Returns an unsubscribe function. */
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  private set(name: string, status: McpStatus) {
    this.status.set(name, status);
    for (const l of this.listeners) l();
  }

  servers(): McpServer[] {
    return Object.entries(this.load()).map(([name, config]) => ({
      name,
      config,
      status: config.disabled ? { state: "disabled" } : (this.status.get(name) ?? { state: "connecting" }),
    }));
  }

  /** Connects every enabled server. Resolves once each has connected or failed. */
  start() {
    return Promise.all(this.servers().filter((s) => !s.config.disabled).map((s) => this.connect(s.name)));
  }

  async connect(name: string): Promise<McpStatus> {
    const config = this.load()[name];
    await this.disconnect(name);
    if (!config) return { state: "failed", error: "not configured" };
    if (config.disabled) return { state: "disabled" };
    const gen = (this.generation.get(name) ?? 0) + 1;
    this.generation.set(name, gen);
    const current = () => this.generation.get(name) === gen;
    this.set(name, { state: "connecting" });

    const conn: Connection = { client: new Client({ name: "megacode", version: "1.0.0" }), transport: createTransport(config), stderr: "" };
    if (conn.transport instanceof StdioClientTransport)
      conn.transport.stderr?.on("data", (d) => (conn.stderr = (conn.stderr + d).slice(-2000)));
    this.connections.set(name, conn);

    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        (async () => {
          await conn.client.connect(conn.transport);
          await this.refreshTools(name, conn, gen);
        })(),
        new Promise((_, reject) => (timer = setTimeout(() => reject(new Error("timed out connecting")), CONNECT_TIMEOUT))),
      ]);
      conn.client.setNotificationHandler(ToolListChangedNotificationSchema, () => this.refreshTools(name, conn, gen).catch(() => {}));
      conn.client.onclose = () => {
        if (!current()) return;
        this.connections.delete(name);
        this.set(name, { state: "failed", error: lastLine(conn.stderr) || "connection closed" });
      };
    } catch (e) {
      if (current()) {
        await this.disconnect(name);
        const stderr = lastLine(conn.stderr);
        this.set(name, { state: "failed", error: [(e as Error).message, stderr].filter(Boolean).join(" · ") });
      }
    } finally {
      clearTimeout(timer);
    }
    return this.status.get(name)!;
  }

  private async refreshTools(name: string, conn: Connection, gen: number) {
    const tools: McpTool[] = [];
    let cursor: string | undefined;
    do {
      const page = await conn.client.listTools(cursor ? { cursor } : undefined);
      for (const t of page.tools)
        tools.push({
          name: toolName(name, t.name),
          server: name,
          tool: t.name,
          description: t.description ?? t.title ?? t.name,
          parameters: { ...t.inputSchema, type: "object", properties: t.inputSchema.properties ?? {} } as ToolSpec["parameters"],
        });
      cursor = page.nextCursor;
    } while (cursor);
    if (this.generation.get(name) === gen) this.set(name, { state: "connected", tools, instructions: conn.client.getInstructions() });
  }

  private async disconnect(name: string) {
    const conn = this.connections.get(name);
    this.connections.delete(name);
    this.generation.set(name, (this.generation.get(name) ?? 0) + 1);
    await conn?.client.close().catch(() => {});
  }

  add(name: string, config: McpServerConfig) {
    this.save({ ...this.load(), [name]: config });
    return this.connect(name);
  }

  async remove(name: string) {
    const { [name]: _, ...rest } = this.load();
    this.save(rest);
    await this.disconnect(name);
    this.status.delete(name);
    for (const l of this.listeners) l();
  }

  async setEnabled(name: string, enabled: boolean) {
    const servers = this.load();
    if (!servers[name]) return;
    const { disabled: _, ...config } = servers[name];
    this.save({ ...servers, [name]: enabled ? config : { ...config, disabled: true } });
    if (enabled) return void (await this.connect(name));
    await this.disconnect(name);
    this.set(name, { state: "disabled" });
  }

  closeAll() {
    return Promise.all([...this.connections.keys()].map((n) => this.disconnect(n)));
  }

  private connected() {
    return [...this.status.values()].filter((s) => s.state === "connected");
  }

  toolSpecs(): ToolSpec[] {
    return this.connected().flatMap((s) => s.tools.map(({ name, description, parameters }) => ({ name, description, parameters })));
  }

  /** Server instructions for the system prompt. */
  instructions(): string {
    return [...this.status.entries()]
      .flatMap(([name, s]) => (s.state === "connected" && s.instructions ? [`Instructions from the ${name} MCP server:\n${s.instructions}`] : []))
      .join("\n\n");
  }

  private find(toolName: string) {
    return this.connected().flatMap((s) => s.tools).find((t) => t.name === toolName);
  }

  has(toolName: string) {
    return !!this.find(toolName);
  }

  async execute(call: ToolCall, approve: Approve, signal?: AbortSignal): Promise<{ output: string; isError: boolean }> {
    const tool = this.find(call.name);
    const conn = tool && this.connections.get(tool.server);
    if (!tool || !conn) return { output: `MCP tool ${call.name} is no longer available.`, isError: true };
    const args = (call.input ?? {}) as Record<string, unknown>;
    const body = Object.keys(args).length ? JSON.stringify(args, null, 2) : "(no arguments)";
    if (!(await approve({ tool: call.name, title: `MCP tool ${tool.server} · ${tool.tool}`, body })))
      return { output: "User denied the tool call.", isError: false };
    try {
      const res = await conn.client.callTool({ name: tool.tool, arguments: args }, undefined, {
        signal,
        timeout: CALL_TIMEOUT,
        resetTimeoutOnProgress: true,
      });
      return { output: await compactOutput(formatResult(res)), isError: !!res.isError };
    } catch (e) {
      return { output: `Error: ${(e as Error).message}`, isError: true };
    }
  }
}

export const mcp = new McpManager();

function createTransport(c: McpServerConfig): Transport {
  if (!("url" in c)) {
    const env = Object.fromEntries(Object.entries({ ...process.env, ...c.env }).filter((e): e is [string, string] => e[1] !== undefined));
    return new StdioClientTransport({ command: c.command, args: c.args ?? [], env, cwd: process.cwd(), stderr: "pipe" });
  }
  const requestInit = c.headers ? { headers: c.headers } : undefined;
  return c.type === "sse"
    ? new SSEClientTransport(new URL(c.url), { requestInit })
    : new StreamableHTTPClientTransport(new URL(c.url), { requestInit });
}

type ContentPart = { type: string; text?: string; mimeType?: string; uri?: string; resource?: { uri: string; text?: string } };

function formatResult(res: { content?: unknown; structuredContent?: unknown; toolResult?: unknown }): string {
  const parts = Array.isArray(res.content) ? (res.content as ContentPart[]) : [];
  const text = parts
    .map((p) => {
      if (p.type === "text") return p.text ?? "";
      if (p.type === "resource") return p.resource?.text ?? `[resource ${p.resource?.uri}]`;
      if (p.type === "resource_link") return `[resource ${p.uri}]`;
      return `[${p.type}${p.mimeType ? ` ${p.mimeType}` : ""} omitted]`;
    })
    .join("\n");
  if (text) return text;
  const structured = res.structuredContent ?? res.toolResult;
  return structured === undefined ? "(no output)" : JSON.stringify(structured, null, 2);
}

const lastLine = (s: string) => s.trim().split("\n").at(-1)?.slice(0, 300) ?? "";

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
