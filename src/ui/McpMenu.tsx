import { Box, Text } from "ink";
import os from "node:os";
import { useEffect, useReducer, useState } from "react";
import { CONFIG_DIR } from "../config.ts";
import { describeServer, mcp, MCP_FILE, SERVER_NAME, splitCommand, transportOf, type McpServerConfig, type McpStatus } from "../mcp.ts";
import { Select } from "./Select.tsx";
import { TextField } from "./TextField.tsx";

type Transport = "stdio" | "http" | "sse";
type Draft = { name: string; type: Transport; target: string; extras: Record<string, string> };
type Screen =
  | { type: "list" }
  | { type: "server"; name: string }
  | { type: "remove"; name: string }
  | { type: "add"; step: "name" | "type" | "target" | "extras"; draft: Draft };

const FILE = `${CONFIG_DIR.replace(os.homedir(), "~")}/${MCP_FILE}`;
const MAX_TOOLS_SHOWN = 15;

export function statusText(s: McpStatus): string {
  switch (s.state) {
    case "connected":
      return `✔ connected · ${s.tools.length} tool${s.tools.length === 1 ? "" : "s"}`;
    case "connecting":
      return "… connecting";
    case "failed":
      return `✗ ${s.error}`;
    case "disabled":
      return "○ disabled";
  }
}

const statusColor = (s: McpStatus) => ({ connected: "green", connecting: "yellow", failed: "red", disabled: "gray" })[s.state];

/** List, add, inspect, reconnect, enable/disable and remove MCP servers. Changes save to ~/.megacode/mcp.json. */
export function McpMenu({ onClose }: { onClose: () => void }) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => mcp.subscribe(rerender), []);
  const [screen, setScreen] = useState<Screen>({ type: "list" });
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const servers = mcp.servers();

  const go = (s: Screen) => {
    setScreen(s);
    setInput("");
    setError("");
  };

  let body: React.ReactNode;
  let help = "↑↓ navigate · enter select · esc back";

  if (screen.type === "list") {
    help = "↑↓ navigate · enter select · esc close";
    body = (
      <>
        {servers.length === 0 && <Text dimColor>No MCP servers yet. Add one to give megacode more tools.</Text>}
        <Select
          options={[
            ...servers.map((s) => ({ label: s.name, value: s.name, hint: statusText(s.status) })),
            { label: "Add server…", value: "" },
          ]}
          onSelect={(name) => (name ? go({ type: "server", name }) : go({ type: "add", step: "name", draft: { name: "", type: "stdio", target: "", extras: {} } }))}
          onCancel={onClose}
        />
      </>
    );
  } else if (screen.type === "server") {
    const server = servers.find((s) => s.name === screen.name);
    if (!server) {
      body = <Text dimColor>Server removed.</Text>;
    } else {
      const { config, status } = server;
      const extras = "url" in config ? Object.keys(config.headers ?? {}) : Object.keys(config.env ?? {});
      const tools = status.state === "connected" ? status.tools : [];
      body = (
        <>
          <Text>
            <Text bold>{server.name}</Text> <Text dimColor>({transportOf(config)})</Text>{" "}
            <Text color={statusColor(status)}>{statusText(status)}</Text>
          </Text>
          <Text dimColor>{describeServer(config)}</Text>
          {extras.length > 0 && <Text dimColor>{"url" in config ? "headers" : "env"}: {extras.join(", ")}</Text>}
          {tools.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              {tools.slice(0, MAX_TOOLS_SHOWN).map((t) => (
                <Text key={t.name}>
                  {"  "}
                  {t.tool}
                  <Text dimColor> {t.description.split("\n")[0]!.slice(0, 70)}</Text>
                </Text>
              ))}
              {tools.length > MAX_TOOLS_SHOWN && <Text dimColor>{`  … and ${tools.length - MAX_TOOLS_SHOWN} more`}</Text>}
            </Box>
          )}
          <Box marginTop={1}>
            <Select
              key={`${server.name}-${status.state}`}
              options={[
                ...(config.disabled
                  ? [{ label: "Enable", value: "enable" }]
                  : [
                      { label: "Reconnect", value: "reconnect" },
                      { label: "Disable", value: "disable" },
                    ]),
                { label: "Remove", value: "remove" },
                { label: "Back", value: "back" },
              ]}
              onSelect={(action) => {
                if (action === "reconnect") mcp.connect(server.name);
                else if (action === "enable") mcp.setEnabled(server.name, true);
                else if (action === "disable") mcp.setEnabled(server.name, false);
                else if (action === "remove") go({ type: "remove", name: server.name });
                else go({ type: "list" });
              }}
              onCancel={() => go({ type: "list" })}
            />
          </Box>
        </>
      );
    }
  } else if (screen.type === "remove") {
    body = (
      <>
        <Text>Remove {screen.name} from {FILE}?</Text>
        <Select
          options={[
            { label: "No, keep it", value: false },
            { label: "Yes, remove", value: true },
          ]}
          onSelect={async (yes) => {
            if (!yes) return go({ type: "server", name: screen.name });
            await mcp.remove(screen.name);
            go({ type: "list" });
          }}
          onCancel={() => go({ type: "server", name: screen.name })}
        />
      </>
    );
  } else {
    const { step, draft } = screen;
    const isUrl = draft.type !== "stdio";
    const back = () =>
      step === "name" ? go({ type: "list" }) : go({ type: "add", step: step === "extras" ? "target" : step === "target" ? "type" : "name", draft });
    help = "enter continue · esc back";

    const field = (prompt: string, placeholder: string, submit: (v: string) => void) => (
      <>
        <Text>{prompt}</Text>
        <TextField
          value={input}
          onChange={(v) => {
            setInput(v);
            setError("");
          }}
          onSubmit={submit}
          onCancel={back}
          placeholder={placeholder}
        />
      </>
    );

    if (step === "name")
      body = field("Server name (used in tool names, e.g. mcp__github__create_issue):", "e.g. github", (v) => {
        if (!SERVER_NAME.test(v)) return setError("Use letters, digits, - and _ (max 32).");
        if (servers.some((s) => s.name === v)) return setError(`A server named ${v} already exists.`);
        go({ type: "add", step: "type", draft: { ...draft, name: v } });
      });
    else if (step === "type")
      body = (
        <>
          <Text>How does megacode reach {draft.name}?</Text>
          <Select
            options={[
              { label: "stdio", value: "stdio" as Transport, hint: "run a local command (npx, uvx, docker, a binary…)" },
              { label: "http", value: "http" as Transport, hint: "remote server, streamable HTTP" },
              { label: "sse", value: "sse" as Transport, hint: "remote server, legacy SSE" },
            ]}
            onSelect={(type) => go({ type: "add", step: "target", draft: { ...draft, type, extras: {} } })}
            onCancel={back}
          />
        </>
      );
    else if (step === "target")
      body = isUrl
        ? field("Server URL:", "https://example.com/mcp", (v) => {
            try {
              if (!/^https?:$/.test(new URL(v).protocol)) throw new Error();
            } catch {
              return setError("Enter an http:// or https:// URL.");
            }
            go({ type: "add", step: "extras", draft: { ...draft, target: v } });
          })
        : field("Command to start the server:", "npx -y @modelcontextprotocol/server-filesystem ~/projects", (v) => {
            if (!splitCommand(v).length) return setError("Enter a command.");
            go({ type: "add", step: "extras", draft: { ...draft, target: v } });
          });
    else
      body = (
        <>
          {Object.entries(draft.extras).map(([k]) => (
            <Text key={k} dimColor>
              {"  "}
              {isUrl ? `${k}: ••••` : `${k}=••••`}
            </Text>
          ))}
          {field(
            isUrl ? "Add a header (Name: value), or press enter to finish:" : "Add an environment variable (KEY=value), or press enter to finish:",
            isUrl ? "Authorization: Bearer …" : "GITHUB_TOKEN=…",
            (v) => {
              if (!v) {
                const config: McpServerConfig = isUrl
                  ? { type: draft.type as "http" | "sse", url: draft.target, ...(Object.keys(draft.extras).length ? { headers: draft.extras } : {}) }
                  : (() => {
                      const [command, ...args] = splitCommand(draft.target);
                      return { command: command!, args, ...(Object.keys(draft.extras).length ? { env: draft.extras } : {}) };
                    })();
                mcp.add(draft.name, config);
                return go({ type: "server", name: draft.name });
              }
              const m = isUrl ? v.match(/^([^:\s]+):\s*(.+)$/) : v.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s);
              if (!m) return setError(isUrl ? "Use the form Name: value" : "Use the form KEY=value");
              go({ type: "add", step: "extras", draft: { ...draft, extras: { ...draft.extras, [m[1]!]: m[2]! } } });
            },
          )}
        </>
      );
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginTop={1}>
      <Text>
        <Text bold>MCP servers</Text>
        <Text dimColor> · {FILE}</Text>
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {body}
        {error && <Text color="red">{error}</Text>}
      </Box>
      <Text dimColor>{help}</Text>
    </Box>
  );
}
