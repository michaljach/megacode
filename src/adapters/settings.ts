import { DEFAULT_SETTINGS, type Settings } from "../core/settings.ts";
import { readJson, writeJson } from "./storage.ts";

const FILE = "settings.json";

// Only values the user changed are written, so later changes to defaults still apply.
let saved: Partial<Settings> | undefined;
const savedSettings = () => (saved ??= readJson<Partial<Settings>>(FILE, {}));

export const loadSettings = (): Settings => ({ ...DEFAULT_SETTINGS, ...savedSettings() });

export function updateSettings(patch: Partial<Settings>) {
  saved = { ...savedSettings(), ...patch };
  writeJson(FILE, saved);
}
