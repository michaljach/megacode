import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import type { ToolCall } from "../../core/conversation.ts";
import type { ExecutionResult, ToolContext, ToolSource, ToolSpec } from "../../core/tools.ts";
import { withTimeout } from "../../lib/async.ts";
import { compactOutput } from "../tools/output.ts";
import { loadServers, saveServers, type McpServerConfig } from "./config.ts";
import { formatResult } from "./results.ts";
import { createTransport } from "./transport.ts";

export type McpTool = ToolSpec & { server: string; tool: string };
export type McpStatus =
  | { state: "disabled" }
  | { state: "connecting" }
  | { state: "connected"; tools: McpTool[]; instructions?: string }
  | { state: "failed"; error: string };
export type McpServer = { name: string; config: McpServerConfig; status: McpStatus };

const CONNECT_TIMEOUT = 30_000;
const CALL_TIMEOUT = 10 * 60_000;

/** Tool names must match ^[A-Za-z0-9_-]{1,64}$ for every provider. */
const toolName = (server: string, tool: string) => `mcp__${server}__${tool.replace(/[^A-Za-z0-9_-]/g, "_")}`.slice(0, 64);

const lastLine = (s: string) => s.trim().split("\n").at(-1)?.slice(0, 300) ?? "";

type Connection = { client: Client; stderr: () => string };

/** Connections to the servers in ~/.megacode/mcp.json, offered to the agent as a ToolSource. */
export class McpManager implements ToolSource {
  #status = new Map<string, McpStatus>();
  #connections = new Map<string, Connection>();
  #generation = new Map<string, number>(); // ignore events from superseded connections
  #listeners = new Set<() => void>();

  /** Re-render hook for the UI. Returns an unsubscribe function. */
  subscribe(listener: () => void) {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  }

  #set(name: string, status: McpStatus | null) {
    if (status) this.#status.set(name, status);
    else this.#status.delete(name);
    for (const l of this.#listeners) l();
  }

  servers(): McpServer[] {
    return Object.entries(loadServers()).map(([name, config]) => ({
      name,
      config,
      status: config.disabled ? { state: "disabled" } : (this.#status.get(name) ?? { state: "connecting" }),
    }));
  }

  /** Connects every enabled server. Resolves once each has connected or failed, with a message per failure. */
  async start(): Promise<string[]> {
    await Promise.all(this.servers().filter((s) => !s.config.disabled).map((s) => this.connect(s.name)));
    return this.servers().flatMap((s) => (s.status.state === "failed" ? [`MCP server ${s.name} failed to connect: ${s.status.error}`] : []));
  }

  async connect(name: string): Promise<McpStatus> {
    const config = loadServers()[name];
    await this.#disconnect(name);
    if (!config) return { state: "failed", error: "not configured" };
    if (config.disabled) return { state: "disabled" };
    const gen = this.#bumpGeneration(name);
    const current = () => this.#generation.get(name) === gen;
    this.#set(name, { state: "connecting" });

    const { transport, stderr } = createTransport(config);
    const conn: Connection = { client: new Client({ name: "megacode", version: "1.0.0" }), stderr };
    this.#connections.set(name, conn);
    try {
      await withTimeout(
        conn.client.connect(transport).then(() => this.#refreshTools(name, conn, gen)),
        CONNECT_TIMEOUT,
        "timed out connecting",
      );
      conn.client.setNotificationHandler(ToolListChangedNotificationSchema, () => this.#refreshTools(name, conn, gen).catch(() => {}));
      conn.client.onclose = () => {
        if (!current()) return;
        this.#connections.delete(name);
        this.#set(name, { state: "failed", error: lastLine(stderr()) || "connection closed" });
      };
    } catch (e) {
      if (current()) {
        await this.#disconnect(name);
        this.#set(name, { state: "failed", error: [(e as Error).message, lastLine(stderr())].filter(Boolean).join(" · ") });
      }
    }
    return this.#status.get(name)!;
  }

  async #refreshTools(name: string, conn: Connection, gen: number) {
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
    if (this.#generation.get(name) === gen) this.#set(name, { state: "connected", tools, instructions: conn.client.getInstructions() });
  }

  #bumpGeneration(name: string) {
    const gen = (this.#generation.get(name) ?? 0) + 1;
    this.#generation.set(name, gen);
    return gen;
  }

  async #disconnect(name: string) {
    const conn = this.#connections.get(name);
    this.#connections.delete(name);
    this.#bumpGeneration(name);
    await conn?.client.close().catch(() => {});
  }

  add(name: string, config: McpServerConfig) {
    saveServers({ ...loadServers(), [name]: config });
    return this.connect(name);
  }

  async remove(name: string) {
    const { [name]: _, ...rest } = loadServers();
    saveServers(rest);
    await this.#disconnect(name);
    this.#set(name, null);
  }

  async setEnabled(name: string, enabled: boolean) {
    const servers = loadServers();
    if (!servers[name]) return;
    const { disabled: _, ...config } = servers[name];
    saveServers({ ...servers, [name]: enabled ? config : { ...config, disabled: true } });
    if (enabled) return void (await this.connect(name));
    await this.#disconnect(name);
    this.#set(name, { state: "disabled" });
  }

  closeAll() {
    return Promise.all([...this.#connections.keys()].map((n) => this.#disconnect(n)));
  }

  #connectedTools(): McpTool[] {
    return [...this.#status.values()].flatMap((s) => (s.state === "connected" ? s.tools : []));
  }

  // ToolSource

  specs(): ToolSpec[] {
    return this.#connectedTools().map(({ name, description, parameters }) => ({ name, description, parameters }));
  }

  has(name: string) {
    return this.#connectedTools().some((t) => t.name === name);
  }

  /** Server instructions for the system prompt. */
  instructions(): string {
    return [...this.#status.entries()]
      .flatMap(([name, s]) => (s.state === "connected" && s.instructions ? [`Instructions from the ${name} MCP server:\n${s.instructions}`] : []))
      .join("\n\n");
  }

  async execute(call: ToolCall, { approve, signal }: ToolContext): Promise<ExecutionResult> {
    const tool = this.#connectedTools().find((t) => t.name === call.name);
    const conn = tool && this.#connections.get(tool.server);
    if (!tool || !conn) return { output: `MCP tool ${call.name} is no longer available.`, isError: true };
    const args = call.input ?? {};
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
