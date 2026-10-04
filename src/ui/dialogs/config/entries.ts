import type { Settings } from "../../../core/settings.ts";

// The /config menu as data: each setting, what it does, and the values it cycles through.

export type Key = Exclude<keyof Settings, "model">;
type Choice = { value: Settings[Key]; label: string };
export type Entry = { key: Key; label: string; description: string; choices: Choice[] };

const seconds = (ms: number) => (ms < 60_000 ? `${ms / 1000}s` : `${ms / 60_000}m`);
const onOff: Choice[] = [
  { value: true, label: "on" },
  { value: false, label: "off" },
];

export const ENTRIES: Entry[] = [
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
    key: "promptAutocomplete",
    label: "Prompt autocomplete",
    description: "Suggest a next prompt from the current conversation; tab accepts without sending. Uses an extra model request after each turn",
    choices: onOff,
  },
  {
    key: "saveHistory",
    label: "Save prompt history",
    description: "Keep ↑/↓ history across sessions in history.json",
    choices: onOff,
  },
];

/** A value's label, or the raw value if it was hand-edited into settings.json and isn't a choice. */
export const choiceLabel = (e: Entry, value: Settings[Key]) => e.choices.find((c) => c.value === value)?.label ?? String(value);
