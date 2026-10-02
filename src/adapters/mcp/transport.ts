import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { McpServerConfig } from "./config.ts";

const STDERR_TAIL = 2000;

/** A transport for the config, plus a getter for the tail of a stdio server's stderr (for error messages). */
export function createTransport(c: McpServerConfig): { transport: Transport; stderr: () => string } {
  if ("url" in c) {
    const requestInit = c.headers ? { headers: c.headers } : undefined;
    const transport = c.type === "sse"
      ? new SSEClientTransport(new URL(c.url), { requestInit })
      : new StreamableHTTPClientTransport(new URL(c.url), { requestInit });
    return { transport, stderr: () => "" };
  }
  const env = Object.fromEntries(Object.entries({ ...process.env, ...c.env }).filter((e): e is [string, string] => e[1] !== undefined));
  const transport = new StdioClientTransport({ command: c.command, args: c.args ?? [], env, cwd: process.cwd(), stderr: "pipe" });
  let stderr = "";
  transport.stderr?.on("data", (d) => (stderr = (stderr + d).slice(-STDERR_TAIL)));
  return { transport, stderr: () => stderr };
}
