import { Box, Text } from "ink";
import { COMMANDS } from "./commands.ts";

const SHORTCUTS: [string, string][] = [
  ["enter", "send message (queued while running)"],
  ["ctrl+s", "send queued messages now (interrupts the running turn)"],
  ["\\ + enter, option+enter", "newline"],
  ["↑ / ↓", "prompt history"],
  ["tab", "accept prompt suggestion / complete command"],
  ["alt+← / alt+→", "move cursor by word"],
  ["/", "commands"],
  ["esc", "interrupt · clear input"],
  ["shift+tab", "cycle permission mode"],
  ["ctrl+a / ctrl+e", "start / end of line"],
  ["ctrl+u / ctrl+k / ctrl+w", "delete to start / end / word"],
  ["ctrl+c", "interrupt · clear · exit (twice)"],
];

export function Help() {
  return (
    <Box flexDirection="column" paddingX={2} marginTop={1}>
      {SHORTCUTS.map(([k, d]) => (
        <Text key={k}>
          <Text color="cyan">{k.padEnd(26)}</Text>
          <Text dimColor>{d}</Text>
        </Text>
      ))}
      <Box marginTop={1} flexDirection="column">
        {COMMANDS.map((c) => (
          <Text key={c.name}>
            <Text color="cyan">{c.name.padEnd(26)}</Text>
            <Text dimColor>{c.description}</Text>
          </Text>
        ))}
      </Box>
    </Box>
  );
}
