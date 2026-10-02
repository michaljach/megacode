import { loadSettings, readJson, writeJson } from "../config.ts";

// Prompt history shared across sessions, newest last.
const MAX = 200;

export const loadHistory = () => (loadSettings().saveHistory ? readJson<string[]>("history.json", []) : []);
export const saveHistory = (entries: string[]) => {
  if (loadSettings().saveHistory) writeJson("history.json", entries.slice(-MAX));
};
