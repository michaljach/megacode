import { Box, Text } from "ink";
import { EFFORTS, type Effort } from "../core/provider.ts";
import { Select } from "./Select.tsx";

/** /effort without an argument: pick the reasoning effort for future turns. */
export function EffortPicker({ current = "default", onSelect, onCancel }: { current?: Effort; onSelect: (effort: Effort) => void; onCancel: () => void }) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginTop={1}>
      <Text bold>Model effort · {current}</Text>
      <Select
        options={EFFORTS.map((effort) => ({ label: effort, value: effort }))}
        initialIndex={Math.max(0, EFFORTS.indexOf(current))}
        onSelect={onSelect}
        onCancel={onCancel}
      />
      <Text dimColor>Saved for future turns · model support varies · esc cancel</Text>
    </Box>
  );
}
