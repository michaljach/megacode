import type { McpStatus } from "../../../adapters/mcp/manager.ts";
import { plural } from "../../../lib/plural.ts";

/** "✔ connected · 3 tools", "… connecting", "✗ <error>", "○ disabled". */
export function statusText(s: McpStatus): string {
  switch (s.state) {
    case "connected":
      return `✔ connected · ${plural(s.tools.length, "tool")}`;
    case "connecting":
      return "… connecting";
    case "failed":
      return `✗ ${s.error}`;
    case "disabled":
      return "○ disabled";
  }
}

export const statusColor = (s: McpStatus) => ({ connected: "green", connecting: "yellow", failed: "red", disabled: "gray" })[s.state];
