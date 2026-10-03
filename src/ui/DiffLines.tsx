import { Box, Text } from "ink";
import { CODE } from "./syntax.ts";
import { DIFF_COLORS, gutter, numberColor, rowBackground, type DiffModel } from "./diff.ts";

/**
 * Diff rows as Claude Code draws them. Changed rows fill their whole width with color; long lines
 * wrap under the code, never under the line numbers.
 */
export function DiffLines({ model }: { model: DiffModel }) {
  return (
    <Box flexDirection="column">
      {model.rows.map((row, i) => {
        if (row.type === "gap")
          return (
            <Text key={i} color={DIFF_COLORS.muted}>
              {gutter(row, model)}…
            </Text>
          );
        const background = rowBackground(row);
        return (
          <Box key={i} backgroundColor={background}>
            <Box flexShrink={0}>
              <Text color={numberColor(row)} backgroundColor={background}>
                {gutter(row, model)}
              </Text>
            </Box>
            <Box flexGrow={1} flexShrink={1} minWidth={0}>
              <Text wrap="wrap" backgroundColor={background}>
                {row.segments.map((s, j) => (
                  <Text key={j} color={s.color ?? CODE} backgroundColor={s.background ?? background}>
                    {s.text}
                  </Text>
                ))}
              </Text>
            </Box>
          </Box>
        );
      })}
      {model.hidden > 0 && <Text color={DIFF_COLORS.muted}>… +{model.hidden} lines</Text>}
    </Box>
  );
}
