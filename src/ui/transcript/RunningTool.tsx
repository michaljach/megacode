import { Box, Text, useAnimation } from "ink";
import type { ToolCall } from "../../core/conversation.ts";
import { DIFF_COLORS } from "../text/diff.ts";
import { CallHeader } from "./CallHeader.tsx";

/** Blinking dot in front of a running tool call. */
function Blink() {
  const { frame } = useAnimation({ interval: 500 });
  return <Text color="cyan">{frame % 2 ? " " : "⏺"}</Text>;
}

/** The tool call in progress. While it waits for approval, just its header with a gray dot. */
export function RunningTool({ call, waiting = false }: { call: ToolCall; waiting?: boolean }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>
        {waiting ? <Text color={DIFF_COLORS.muted}>⏺</Text> : <Blink />} <CallHeader call={call} />
      </Text>
      {!waiting && <Text color={DIFF_COLORS.muted}>{"  ⎿  Running…"}</Text>}
    </Box>
  );
}
