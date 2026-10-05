import { Box, Text } from "ink";
import type { ComponentProps } from "react";
import type { Command } from "../commands.ts";
import { Help } from "./Help.tsx";
import { PromptInput } from "./PromptInput.tsx";
import { StatusLine } from "./StatusLine.tsx";

/** The bottom of the screen: the prompt, the status line under it, an update notice, and the shortcuts help. */
export function PromptArea({
  value,
  onChange,
  onSubmit,
  onToggleHelp,
  showHelp,
  history,
  commands,
  suggestion,
  autocomplete,
  running,
  status,
  updateVersion,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onToggleHelp: () => void;
  showHelp: boolean;
  history: string[];
  commands: Command[];
  suggestion: string;
  autocomplete: boolean;
  running: boolean;
  status: ComponentProps<typeof StatusLine>;
  updateVersion?: string | null;
}) {
  return (
    <Box flexDirection="column">
      <PromptInput
        value={value}
        onChange={onChange}
        onSubmit={onSubmit}
        onHelp={onToggleHelp}
        isActive
        history={history}
        autocomplete={autocomplete && !running}
        suggestion={suggestion}
        commands={commands}
        placeholder={running ? "queue another message…" : "tiny moon vibes"}
      />
      <StatusLine {...status} />
      {updateVersion && (
        <Box paddingX={2}>
          <Text dimColor>Reopen to install update · v{updateVersion}</Text>
        </Box>
      )}
      {showHelp && <Help />}
    </Box>
  );
}
