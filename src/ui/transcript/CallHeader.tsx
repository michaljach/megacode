import { Text } from "ink";
import type { ToolCall } from "../../core/conversation.ts";
import { callParts } from "../text/format.ts";

/** "Update(src/a.ts)" with only the tool name in bold. */
export function CallHeader({ call }: { call: ToolCall }) {
  const { name, arg } = callParts(call);
  return (
    <Text>
      <Text bold>{name}</Text>({arg})
    </Text>
  );
}
