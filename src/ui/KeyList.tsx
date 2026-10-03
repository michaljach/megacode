import { Box, Text } from "ink";

/**
 * Keys or commands in one column, what they do in the next. Long descriptions wrap inside
 * their own column, so the left column stays readable at any width.
 */
export function KeyList({ rows, selected }: { rows: [key: string, text: string][]; selected?: number }) {
  const width = Math.max(...rows.map(([key]) => key.length)) + 2;
  return (
    <Box flexDirection="column">
      {rows.map(([key, text], i) => (
        <Box key={key}>
          <Box width={width} flexShrink={0}>
            <Text color="cyan">{key}</Text>
          </Box>
          <Box flexShrink={1} minWidth={0}>
            <Text dimColor={i !== selected} color={i === selected ? "cyan" : undefined}>{text}</Text>
          </Box>
        </Box>
      ))}
    </Box>
  );
}
