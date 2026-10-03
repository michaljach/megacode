import { Box, Text, useInput } from "ink";
import { useState, type ReactNode } from "react";

export type Option<T> = { label: ReactNode; value: T; hint?: string };

/**
 * Arrow-key list: ↑/↓ (or ctrl+p/n) to move, enter to pick, 1-9 to pick directly, esc to cancel.
 * `accent` colors the cursor and selected label; `numberColor` the "1." column.
 */
export function Select<T>({
  options,
  onSelect,
  onCancel,
  initialIndex = 0,
  accent = "cyan",
  numberColor,
}: {
  options: Option<T>[];
  onSelect: (value: T) => void;
  onCancel?: () => void;
  initialIndex?: number;
  accent?: string;
  numberColor?: string;
}) {
  const [index, setIndex] = useState(initialIndex);

  useInput((input, key) => {
    if (key.upArrow || (key.ctrl && input === "p")) setIndex((i) => (i - 1 + options.length) % options.length);
    else if (key.downArrow || (key.ctrl && input === "n")) setIndex((i) => (i + 1) % options.length);
    else if (key.return) onSelect(options[index]!.value);
    else if (key.escape) onCancel?.();
    else if (/^[1-9]$/.test(input) && Number(input) <= options.length) onSelect(options[Number(input) - 1]!.value);
  });

  // "❯ 1. " stays in its own column so long labels wrap under the label, not under the number.
  const marker = `❯ ${options.length}. `.length;
  return (
    <Box flexDirection="column">
      {options.map((o, i) => {
        const selected = i === index;
        return (
          <Box key={i}>
            <Box width={marker} flexShrink={0}>
              <Text>
                <Text color={accent}>{selected ? "❯ " : "  "}</Text>
                <Text color={numberColor ?? (selected ? accent : undefined)}>{i + 1}.</Text>
              </Text>
            </Box>
            <Box flexShrink={1} minWidth={0}>
              <Text color={selected ? accent : undefined}>
                {o.label}
                {o.hint ? <Text dimColor> {o.hint}</Text> : null}
              </Text>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
