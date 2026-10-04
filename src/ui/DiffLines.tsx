import { Box, Text } from "ink";
import { DIFF_COLORS, gutter, pieces, rowStyle, type DiffModel } from "./diff.ts";

/** Diff rows as Claude Code draws them. Changed rows fill their width; long lines wrap under the code. */
export function DiffLines({ model }: { model: DiffModel }) {
  return (
    <Box flexDirection="column">
      {model.rows.map((row, i) => {
        if (row.type === "gap") return <Text key={i} color={DIFF_COLORS.muted}>{gutter(row, model)}…</Text>;
        const style = rowStyle(row);
        return (
          <Box key={i} backgroundColor={style.background}>
            <Box flexShrink={0}>
              <Text color={style.color} backgroundColor={style.background}>{gutter(row, model)}</Text>
            </Box>
            <Box flexGrow={1} flexShrink={1} minWidth={0}>
              <Text wrap="wrap" color={style.color} backgroundColor={style.background}>
                {pieces(row).map((p, j) => <Text key={j} backgroundColor={p.changed ? style.word : style.background}>{p.text}</Text>)}
              </Text>
            </Box>
          </Box>
        );
      })}
      {model.hidden > 0 && <Text color={DIFF_COLORS.muted}>… +{model.hidden} lines</Text>}
    </Box>
  );
}
