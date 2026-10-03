import { DEFAULT_SETTINGS, type Settings } from "../core/settings.ts";
import { configDir, readJson, writeJson } from "./storage.ts";

const FILE = "settings.json";

// Only values the user changed are written, so later changes to defaults still apply.
let cache: { dir: string; saved: Partial<Settings> } | undefined;
function savedSettings(): Partial<Settings> {
  if (cache?.dir !== configDir()) cache = { dir: configDir(), saved: readJson<Partial<Settings>>(FILE, {}) };
  return cache.saved;
}

export const loadSettings = (): Settings => ({ ...DEFAULT_SETTINGS, ...savedSettings() });

export function updateSettings(patch: Partial<Settings>) {
  cache = { dir: configDir(), saved: { ...savedSettings(), ...patch } };
  writeJson(FILE, cache.saved);
}
