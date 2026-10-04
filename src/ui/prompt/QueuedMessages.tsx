import { Box, Text } from "ink";
import { previewPrompt } from "../text/format.ts";

/** Messages typed while a turn runs, oldest first, each with its ctrl+digit shortcut. */
export function QueuedMessages({ queued }: { queued: string[] }) {
  if (!queued.length) return null;
  return (
    <Box flexDirection="column" marginTop={1} paddingX={2} backgroundColor="#262626">
      {queued.map((q, i) => (
        <Text key={i} dimColor wrap="wrap">
          {"⏳ "}
          {previewPrompt(q)}
          {i < 9 && ` (ctrl+${i + 1} to send now)`}
        </Text>
      ))}
    </Box>
  );
}
