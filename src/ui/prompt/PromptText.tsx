import { Box, Text } from "ink";
import type { ReactNode } from "react";

/** One row of the prompt: "> " on the first, an indent on the rest; long lines wrap under the text. */
function Line({ first, children }: { first: boolean; children: ReactNode }) {
  return (
    <Box>
      <Box flexShrink={0}>
        <Text>{first ? "> " : "  "}</Text>
      </Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text wrap="wrap">{children}</Text>
      </Box>
    </Box>
  );
}

/** The prompt text with a block cursor and a dim suggested completion after it, or the placeholder when empty. */
export function PromptText({
  value,
  completion,
  cursor,
  isActive,
  placeholder,
}: {
  value: string;
  completion: string;
  cursor: number;
  isActive: boolean;
  placeholder: string;
}) {
  if (value === "" && !completion)
    return (
      <Line first>
        {isActive ? <Text inverse>{placeholder[0]}</Text> : null}
        <Text dimColor>{isActive ? placeholder.slice(1) : placeholder}</Text>
      </Line>
    );

  let offset = 0;
  return (value + completion).split("\n").map((line, i) => {
    const start = offset;
    offset += line.length + 1;
    const col = cursor - start;
    return (
      <Line key={i} first={i === 0}>
        {isActive && col >= 0 && col <= line.length ? (
          <>
            {line.slice(0, col)}
            <Text inverse dimColor={!!completion}>{line[col] ?? " "}</Text>
            <Text dimColor={!!completion}>{line.slice(col + 1)}</Text>
          </>
        ) : (
          <Text dimColor={start > value.length}>{line || " "}</Text>
        )}
      </Line>
    );
  });
}
