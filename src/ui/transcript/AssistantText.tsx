import { Box, Text } from "ink";
import { renderMarkdown } from "../text/markdown.ts";
import { TranscriptRow } from "./TranscriptRow.tsx";

/** Assistant Markdown; `first` marks the start of a reply (also used for the live, still-streaming text). */
export function AssistantText({ text, first }: { text: string; first: boolean }) {
  return (
    <Box marginTop={first ? 1 : 0}>
      <TranscriptRow prefix={<Text>{first ? "⏺ " : "  "}</Text>} width={2}>
        <Text>{renderMarkdown(text)}</Text>
      </TranscriptRow>
    </Box>
  );
}
