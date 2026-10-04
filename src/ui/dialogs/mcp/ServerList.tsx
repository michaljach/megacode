import { Box, Text } from "ink";
import type { McpServer } from "../../../adapters/mcp/manager.ts";
import { Select } from "../../components/Select.tsx";
import { statusText } from "./status.ts";

/** Every configured server with its status, then "Add server…". */
export function ServerList({
  servers,
  onOpen,
  onAdd,
  onClose,
}: {
  servers: McpServer[];
  onOpen: (name: string) => void;
  onAdd: () => void;
  onClose: () => void;
}) {
  return (
    <>
      {servers.length === 0 && (
        <Box marginBottom={1}>
          <Text dimColor>No MCP servers yet. Add one to give megacode more tools.</Text>
        </Box>
      )}
      <Select
        options={[...servers.map((s) => ({ label: s.name, value: s.name, hint: statusText(s.status) })), { label: "Add server…", value: "" }]}
        onSelect={(name) => (name ? onOpen(name) : onAdd())}
        onCancel={onClose}
      />
    </>
  );
}
