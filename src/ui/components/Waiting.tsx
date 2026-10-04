import { Text, useAnimation } from "ink";

/** Braille spinner with a message, for dialogs waiting on the network or a browser. */
export function Waiting({ text }: { text: string }) {
  const { frame } = useAnimation({ interval: 100 });
  return (
    <Text>
      <Text color="cyan">{"⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"[frame % 10]}</Text> {text}
    </Text>
  );
}
