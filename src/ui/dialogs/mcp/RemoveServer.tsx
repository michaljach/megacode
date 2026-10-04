import { Text } from "ink";
import { mcp } from "../../../adapters/mcp/manager.ts";
import { Select } from "../../components/Select.tsx";

/** Confirms removing a server from the config file; `onDone` says whether it was removed. */
export function RemoveServer({ name, file, onDone }: { name: string; file: string; onDone: (removed: boolean) => void }) {
  return (
    <>
      <Text>Remove {name} from {file}?</Text>
      <Select
        options={[
          { label: "No, keep it", value: false },
          { label: "Yes, remove", value: true },
        ]}
        onSelect={async (yes) => {
          if (yes) await mcp.remove(name);
          onDone(yes);
        }}
        onCancel={() => onDone(false)}
      />
    </>
  );
}
