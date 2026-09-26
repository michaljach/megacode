import { readJson, writeJson } from "../config.ts";

// Prompt history shared across sessions, newest last.
const MAX = 200;

export const loadHistory = () => readJson<string[]>("history.json", []);
export const saveHistory = (entries: string[]) => writeJson("history.json", entries.slice(-MAX));
