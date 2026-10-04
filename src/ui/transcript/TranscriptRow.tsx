import { Box } from "ink";
import type { ReactNode } from "react";

/** A transcript line with a prefix ("⏺ ", "  ⎿  ") kept out of the text's wrapping width, also on continuation lines. */
export function TranscriptRow({ prefix, width, children }: { prefix: ReactNode; width: number; children: ReactNode }) {
  return (
    <Box width="100%">
      <Box width={width} flexShrink={0}>{prefix}</Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={1} flexBasis={0} minWidth={0}>
        {children}
      </Box>
    </Box>
  );
}
