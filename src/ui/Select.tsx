import { Box, Text, useInput } from "ink";
import { useState } from "react";

export type Option<T> = { label: string; value: T; hint?: string };

/** Arrow-key list: ↑/↓ (or ctrl+p/n) to move, enter to pick, 1-9 to pick directly, esc to cancel. */
export function Select<T>({
  options,
  onSelect,
  onCancel,
  initialIndex = 0,
}: {
  options: Option<T>[];
  onSelect: (value: T) => void;
  onCancel?: () => void;
  initialIndex?: number;
}) {
  const [index, setIndex] = useState(initialIndex);

  useInput((input, key) => {
    if (key.upArrow || (key.ctrl && input === "p")) setIndex((i) => (i - 1 + options.length) % options.length);
    else if (key.downArrow || (key.ctrl && input === "n")) setIndex((i) => (i + 1) % options.length);
    else if (key.return) onSelect(options[index]!.value);
    else if (key.escape) onCancel?.();
    else if (/^[1-9]$/.test(input) && Number(input) <= options.length) onSelect(options[Number(input) - 1]!.value);
  });

  return (
    <Box flexDirection="column">
      {options.map((o, i) => (
        <Text key={i} color={i === index ? "cyan" : undefined}>
          {i === index ? "❯ " : "  "}
          {i + 1}. {o.label}
          {o.hint ? <Text dimColor> {o.hint}</Text> : null}
        </Text>
      ))}
    </Box>
  );
}
