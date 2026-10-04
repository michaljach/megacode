import { Box, Text } from "ink";
import type { ToolCall } from "../../core/conversation.ts";
import { DIFF_COLORS, type DiffModel } from "../text/diff.ts";
import { previewOutput } from "../text/format.ts";
import { CallHeader } from "./CallHeader.tsx";
import { DiffLines } from "./DiffLines.tsx";
import { TranscriptRow } from "./TranscriptRow.tsx";

/** Claude Code's color for a finished call. */
const DONE = "#4eba65";

/** A finished tool call: its header, a preview of the output (or the change summary), and the diff for file edits. */
export function ToolResult({ call, output, isError, diff }: { call: ToolCall; output: string; isError: boolean; diff?: DiffModel }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <TranscriptRow prefix={<Text color={isError ? "red" : DONE}>⏺ </Text>} width={2}>
        <CallHeader call={call} />
      </TranscriptRow>
      <TranscriptRow prefix={<Text color={DIFF_COLORS.muted}>{"  ⎿  "}</Text>} width={5}>
        {diff ? (
          <Text>{output}</Text>
        ) : (
          <Text dimColor={!isError} color={isError ? "red" : undefined}>
            {previewOutput(output) || "(no output)"}
          </Text>
        )}
      </TranscriptRow>
      {diff && (
        // Claude Code's diff band: from the output column to 7 short of the right edge.
        <Box marginLeft={5} marginRight={7} flexDirection="column">
          <DiffLines model={diff} />
        </Box>
      )}
    </Box>
  );
}
