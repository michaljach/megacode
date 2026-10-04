import { Box, Text } from "ink";
import { describeServer, transportOf } from "../../../adapters/mcp/config.ts";
import { mcp, type McpServer } from "../../../adapters/mcp/manager.ts";
import { Select, type Option } from "../../components/Select.tsx";
import { statusColor, statusText } from "./status.ts";

type Action = "reconnect" | "enable" | "disable" | "remove" | "back";

const MAX_TOOLS_SHOWN = 15;

/** One server: transport, target, env or header names, its tools, and what can be done with it. */
export function ServerDetails({ server, onRemove, onBack }: { server: McpServer | undefined; onRemove: () => void; onBack: () => void }) {
  if (!server) return <Text dimColor>Server removed.</Text>;
  const { name, config, status } = server;
  const extras = Object.keys(("url" in config ? config.headers : config.env) ?? {});
  const tools = status.state === "connected" ? status.tools : [];
  const actions: Option<Action>[] = [
    ...(config.disabled
      ? [{ label: "Enable", value: "enable" as const }]
      : [{ label: "Reconnect", value: "reconnect" as const }, { label: "Disable", value: "disable" as const }]),
    { label: "Remove", value: "remove" },
    { label: "Back", value: "back" },
  ];
  const run: Record<Action, () => unknown> = {
    reconnect: () => mcp.connect(name),
    enable: () => mcp.setEnabled(name, true),
    disable: () => mcp.setEnabled(name, false),
    remove: onRemove,
    back: onBack,
  };

  return (
    <>
      <Text>
        <Text bold>{name}</Text> <Text dimColor>({transportOf(config)})</Text> <Text color={statusColor(status)}>{statusText(status)}</Text>
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
        <Select key={`${name}-${status.state}`} options={actions} onSelect={(action) => run[action]()} onCancel={onBack} />
      </Box>
    </>
  );
}
