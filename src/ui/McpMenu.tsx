import { Box, Text } from "ink";
import { useEffect, useReducer, useState } from "react";
import {
  describeServer,
  draftToConfig,
  MCP_FILE,
  parseExtra,
  transportOf,
  type McpTransport,
  type ServerDraft,
} from "../adapters/mcp/config.ts";
import { mcp, type McpStatus } from "../adapters/mcp/manager.ts";
import { configDir } from "../adapters/storage.ts";
import { previousAddStep, serverNameError, targetError, type AddStep } from "./mcpWizard.ts";
import { tildify } from "./format.ts";
import { Dialog } from "./Dialog.tsx";
import { Select } from "./Select.tsx";
import { TextField } from "./TextField.tsx";

type Draft = ServerDraft & { name: string };
type Screen =
  | { type: "list" }
  | { type: "server"; name: string }
  | { type: "remove"; name: string }
  | { type: "add"; step: AddStep; draft: Draft };

const MAX_TOOLS_SHOWN = 15;

function statusText(s: McpStatus): string {
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
  const file = `${tildify(configDir())}/${MCP_FILE}`;

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
        {servers.length === 0 && (
          <Box marginBottom={1}>
            <Text dimColor>No MCP servers yet. Add one to give megacode more tools.</Text>
          </Box>
        )}
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
        <Text>Remove {screen.name} from {file}?</Text>
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
    const back = () => {
      const previous = previousAddStep(step);
      go(previous ? { type: "add", step: previous, draft } : { type: "list" });
    };
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
        const problem = serverNameError(v, servers.map((s) => s.name));
        if (problem) return setError(problem);
        go({ type: "add", step: "type", draft: { ...draft, name: v } });
      });
    else if (step === "type")
      body = (
        <>
          <Text>How does megacode reach {draft.name}?</Text>
          <Select
            options={[
              { label: "stdio", value: "stdio" as McpTransport, hint: "run a local command (npx, uvx, docker, a binary…)" },
              { label: "http", value: "http" as McpTransport, hint: "remote server, streamable HTTP" },
              { label: "sse", value: "sse" as McpTransport, hint: "remote server, legacy SSE" },
            ]}
            onSelect={(type) => go({ type: "add", step: "target", draft: { ...draft, type, extras: {} } })}
            onCancel={back}
          />
        </>
      );
    else if (step === "target")
      body = field(
        isUrl ? "Server URL:" : "Command to start the server:",
        isUrl ? "https://example.com/mcp" : "npx -y @modelcontextprotocol/server-filesystem ~/projects",
        (v) => {
          const problem = targetError(draft.type, v);
          if (problem) return setError(problem);
          go({ type: "add", step: "extras", draft: { ...draft, target: v } });
        },
      );
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
                mcp.add(draft.name, draftToConfig(draft));
                return go({ type: "server", name: draft.name });
              }
              const extra = parseExtra(draft.type, v);
              if (!extra) return setError(isUrl ? "Use the form Name: value" : "Use the form KEY=value");
              const [key, value] = extra;
              go({ type: "add", step: "extras", draft: { ...draft, extras: { ...draft.extras, [key]: value } } });
            },
          )}
        </>
      );
  }

  return (
    <Dialog title="MCP servers" subtitle={file} footer={help}>
      {body}
      {error && <Text color="red">{error}</Text>}
    </Dialog>
  );
}
