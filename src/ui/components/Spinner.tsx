import { Box, Text, useAnimation } from "ink";

const FRAMES = ["·", "✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳", "✢"];

/** "✻ Thinking… (3s · esc to interrupt)" while a turn runs. */
export function Spinner({ verb }: { verb: string }) {
  const { frame, time } = useAnimation({ interval: 120 });
  return (
    <Box marginTop={1}>
      <Text color="cyan">
        {FRAMES[frame % FRAMES.length]} {verb}…{" "}
      </Text>
      <Text dimColor>({Math.floor(time / 1000)}s · esc to interrupt)</Text>
    </Box>
  );
}
