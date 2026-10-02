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

/** Blinking dot in front of a running tool call. */
export function Blink() {
  const { frame } = useAnimation({ interval: 500 });
  return <Text color="cyan">{frame % 2 ? " " : "⏺"}</Text>;
}

/** Braille spinner with a message, for dialogs waiting on the network or a browser. */
export function Waiting({ text }: { text: string }) {
  const { frame } = useAnimation({ interval: 100 });
  return (
    <Text>
      <Text color="cyan">{"⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"[frame % 10]}</Text> {text}
    </Text>
  );
}
