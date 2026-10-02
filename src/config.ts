import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Everything megacode persists lives in ~/.megacode.
export const CONFIG_DIR = path.join(os.homedir(), ".megacode");

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path.join(CONFIG_DIR, file), "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJson(file: string, data: unknown, opts: { secret?: boolean } = {}) {
  try {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    const p = path.join(CONFIG_DIR, file);
    writeFileSync(p, JSON.stringify(data, null, 2), { mode: opts.secret ? 0o600 : 0o644 });
    if (opts.secret) chmodSync(p, 0o600); // mode is ignored when the file already exists
  } catch {
    // persistence is a convenience; ignore write failures
  }
}

/** OAuth tokens from "Sign in with ChatGPT". */
export type ChatGPTTokens = { access: string; refresh: string; expires: number; accountId: string; email?: string; plan?: string };

/** Saved credentials per provider. Environment variables take precedence. */
export type SavedAuth = Record<string, { apiKey?: string; baseURL?: string; chatgpt?: ChatGPTTokens }>;
export const loadAuth = () => readJson<SavedAuth>("auth.json", {});
export const saveAuth = (auth: SavedAuth) => writeJson("auth.json", auth, { secret: true });

export type PermissionMode = "ask" | "accept-edits" | "yolo";

/** User preferences, edited with /config. */
export type Settings = {
  model?: string;
  permissionMode: PermissionMode;
  maxSteps: number;
  bashTimeoutMs: number;
  maxToolOutput: number;
  projectInstructions: boolean;
  saveHistory: boolean;
  /** What new worktrees branch from: the remote's default branch, or the current commit. */
  worktreeBase: "fresh" | "head";
};

export const DEFAULT_SETTINGS: Settings = {
  permissionMode: "yolo",
  maxSteps: 50,
  bashTimeoutMs: 120_000,
  maxToolOutput: 12_000,
  projectInstructions: true,
  saveHistory: true,
  worktreeBase: "fresh",
};

// Only values the user changed are written, so later changes to defaults still apply.
let saved: Partial<Settings> | undefined;
const savedSettings = () => (saved ??= readJson<Partial<Settings>>("settings.json", {}));
export const loadSettings = (): Settings => ({ ...DEFAULT_SETTINGS, ...savedSettings() });
export function updateSettings(patch: Partial<Settings>) {
  saved = { ...savedSettings(), ...patch };
  writeJson("settings.json", saved);
}
