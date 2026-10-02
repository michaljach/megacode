import { Box, Text, useInput } from "ink";
import os from "node:os";
import { useState } from "react";
import { CONFIG_DIR, DEFAULT_SETTINGS, loadSettings, type PermissionMode, type Settings } from "../config.ts";

type Key = Exclude<keyof Settings, "model">;
type Choice = { value: Settings[Key]; label: string };
type Entry = { key: Key; label: string; description: string; choices: Choice[] };

const DIR = CONFIG_DIR.replace(os.homedir(), "~");
const seconds = (ms: number) => (ms < 60_000 ? `${ms / 1000}s` : `${ms / 60_000}m`);
const onOff: Choice[] = [
  { value: true, label: "on" },
  { value: false, label: "off" },
];

const ENTRIES: Entry[] = [
  {
    key: "permissionMode",
    label: "Permission mode",
    description: "Ask before writes, edits and shell commands, auto-accept edits only, or bypass all prompts. Applies now and to new sessions (--ask overrides; shift+tab cycles)",
    choices: [
      { value: "ask", label: "ask" },
      { value: "accept-edits", label: "accept edits" },
      { value: "yolo", label: "bypass" },
    ],
  },
  {
    key: "maxSteps",
    label: "Max steps per turn",
    description: "Model calls the agent may make for one message before it stops",
    choices: [25, 50, 100, 200].map((n) => ({ value: n, label: String(n) })),
  },
  {
    key: "bashTimeoutMs",
    label: "Shell command timeout",
    description: "How long a bash command may run, unless the model asks for a different timeout",
    choices: [30_000, 120_000, 300_000, 600_000].map((n) => ({ value: n, label: seconds(n) })),
  },
  {
    key: "maxToolOutput",
    label: "Max tool output",
    description: "Characters of command and MCP output sent to the model; longer output keeps both ends and is saved to a temp file the model can read",
    choices: [6_000, 12_000, 30_000, 100_000].map((n) => ({ value: n, label: `${n / 1000}k chars` })),
  },
  {
    key: "projectInstructions",
    label: "Load AGENTS.md / CLAUDE.md",
    description: "Add project instruction files from the working directory to the system prompt",
    choices: onOff,
  },
  {
    key: "worktreeBase",
    label: "Worktree base",
    description: "What /worktree and -w branch from: the remote's default branch (origin/HEAD), or the commit you're on",
    choices: [
      { value: "fresh", label: "default branch" },
      { value: "head", label: "current commit" },
    ],
  },
  {
    key: "saveHistory",
    label: "Save prompt history",
    description: `Keep ↑/↓ history across sessions in ${DIR}/history.json`,
    choices: onOff,
  },
];

const label = (e: Entry, value: Settings[Key]) => e.choices.find((c) => c.value === value)?.label ?? String(value);

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

  const cycle = (e: Entry, step: number) => {
    const i = e.choices.findIndex((c) => c.value === settings[e.key]);
    // A value hand-edited into settings.json may not be a choice; start from the first one.
    const next = e.choices[i === -1 ? 0 : (i + step + e.choices.length) % e.choices.length]!.value;
    const patch = { [e.key]: next } as Partial<Settings>;
    setSettings((s) => ({ ...s, ...patch }));
    onChange(patch);
  };

  useInput((input, key) => {
    if (key.escape) return onClose();
    if (key.upArrow || (key.ctrl && input === "p")) return setIndex((i) => (i - 1 + rows) % rows);
    if (key.downArrow || (key.ctrl && input === "n")) return setIndex((i) => (i + 1) % rows);
    const activate = key.return || input === " ";
    if (index === 0) return activate ? onModel() : undefined;
    if (activate || key.rightArrow) cycle(ENTRIES[index - 1]!, 1);
    else if (key.leftArrow) cycle(ENTRIES[index - 1]!, -1);
  });

  const selected = index === 0 ? null : ENTRIES[index - 1]!;
  const description = selected ? selected.description : "Model for new messages (opens the model picker)";

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginTop={1}>
      <Text>
        <Text bold>Settings</Text>
        <Text dimColor> · saved to {DIR}/settings.json</Text>
      </Text>
      <Box flexDirection="column" marginTop={1}>
        <Row selected={index === 0} label="Model" value={model} />
        {ENTRIES.map((e, i) => (
          <Row
            key={e.key}
            selected={index === i + 1}
            label={e.label}
            value={label(e, settings[e.key])}
            isDefault={settings[e.key] === DEFAULT_SETTINGS[e.key]}
          />
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>{description}</Text>
      </Box>
      <Text dimColor>↑↓ navigate · enter/space/←→ change · esc close</Text>
    </Box>
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
