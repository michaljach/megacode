import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { loadSettings } from "../../../adapters/settings.ts";
import { configDir } from "../../../adapters/storage.ts";
import { DEFAULT_SETTINGS, type PermissionMode, type Settings } from "../../../core/settings.ts";
import { cycle } from "../../../lib/cycle.ts";
import { Dialog } from "../../components/Dialog.tsx";
import { listStep } from "../../components/Select.tsx";
import { tildify } from "../../text/format.ts";
import { choiceLabel, ENTRIES, type Entry } from "./entries.ts";

/** Every setting in one list: ↑/↓ to move, enter/space/←/→ to change, esc to close. Changes save immediately. */
export function ConfigMenu({
  model,
  mode,
  onChange,
  onModel,
  onClose,
}: {
  model: string;
  /** The current session's permission mode, which shift+tab may have changed since it was saved. */
  mode: PermissionMode;
  onChange: (patch: Partial<Settings>) => void;
  onModel: () => void;
  onClose: () => void;
}) {
  const [settings, setSettings] = useState(() => ({ ...loadSettings(), permissionMode: mode }));
  const [index, setIndex] = useState(0);
  const rows = ENTRIES.length + 1; // row 0 is the model

  const cycleChoice = (e: Entry, step: number) => {
    const i = e.choices.findIndex((c) => c.value === settings[e.key]);
    // A value hand-edited into settings.json may not be a choice; start from the first one.
    const next = e.choices[i === -1 ? 0 : cycle(i, step, e.choices.length)]!.value;
    const patch = { [e.key]: next } as Partial<Settings>;
    setSettings((s) => ({ ...s, ...patch }));
    onChange(patch);
  };

  useInput((input, key) => {
    if (key.escape) return onClose();
    const step = listStep(input, key);
    if (step) return setIndex((i) => cycle(i, step, rows));
    const activate = key.return || input === " ";
    if (index === 0) return activate ? onModel() : undefined;
    if (activate || key.rightArrow) cycleChoice(ENTRIES[index - 1]!, 1);
    else if (key.leftArrow) cycleChoice(ENTRIES[index - 1]!, -1);
  });

  const selected = index === 0 ? null : ENTRIES[index - 1]!;
  const description = selected ? selected.description : "Model for new messages (opens the model picker)";

  return (
    <Dialog
      title="Settings"
      subtitle={`saved to ${tildify(configDir())}/settings.json`}
      footer="↑↓ navigate · enter/space/←→ change · esc close"
    >
      <Box flexDirection="column">
        <Row selected={index === 0} label="Model" value={model} />
        {ENTRIES.map((e, i) => (
          <Row
            key={e.key}
            selected={index === i + 1}
            label={e.label}
            value={choiceLabel(e, settings[e.key])}
            isDefault={settings[e.key] === DEFAULT_SETTINGS[e.key]}
          />
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>{description}</Text>
      </Box>
    </Dialog>
  );
}

function Row({ selected, label, value, isDefault = true }: { selected: boolean; label: string; value: string; isDefault?: boolean }) {
  return (
    <Text color={selected ? "cyan" : undefined}>
      {selected ? "❯ " : "  "}
      {label.padEnd(30)}
      <Text bold={!isDefault}>{value}</Text>
    </Text>
  );
}
