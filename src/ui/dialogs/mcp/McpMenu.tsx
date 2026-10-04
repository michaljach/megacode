import { useEffect, useReducer, useState } from "react";
import { MCP_FILE } from "../../../adapters/mcp/config.ts";
import { mcp } from "../../../adapters/mcp/manager.ts";
import { configDir } from "../../../adapters/storage.ts";
import { Dialog } from "../../components/Dialog.tsx";
import { tildify } from "../../text/format.ts";
import { AddServerWizard } from "./AddServerWizard.tsx";
import { RemoveServer } from "./RemoveServer.tsx";
import { ServerDetails } from "./ServerDetails.tsx";
import { ServerList } from "./ServerList.tsx";

type Screen = { type: "list" } | { type: "server"; name: string } | { type: "remove"; name: string } | { type: "add" };

const FOOTERS: Record<Screen["type"], string> = {
  list: "↑↓ navigate · enter select · esc close",
  server: "↑↓ navigate · enter select · esc back",
  remove: "↑↓ navigate · enter select · esc back",
  add: "enter continue · esc back",
};

/** List, add, inspect, reconnect, enable/disable and remove MCP servers. Changes save to mcp.json in the config folder. */
export function McpMenu({ onClose }: { onClose: () => void }) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => mcp.subscribe(rerender), []);
  const [screen, setScreen] = useState<Screen>({ type: "list" });
  const servers = mcp.servers();
  const file = `${tildify(configDir())}/${MCP_FILE}`;
  const showList = () => setScreen({ type: "list" });
  const open = (name: string) => setScreen({ type: "server", name });

  return (
    <Dialog title="MCP servers" subtitle={file} footer={FOOTERS[screen.type]}>
      {screen.type === "list" && <ServerList servers={servers} onOpen={open} onAdd={() => setScreen({ type: "add" })} onClose={onClose} />}
      {screen.type === "server" && (
        <ServerDetails
          server={servers.find((s) => s.name === screen.name)}
          onRemove={() => setScreen({ type: "remove", name: screen.name })}
          onBack={showList}
        />
      )}
      {screen.type === "remove" && <RemoveServer name={screen.name} file={file} onDone={(removed) => (removed ? showList() : open(screen.name))} />}
      {screen.type === "add" && <AddServerWizard existing={servers.map((s) => s.name)} onAdded={open} onCancel={showList} />}
    </Dialog>
  );
}
