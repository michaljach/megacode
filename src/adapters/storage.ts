import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

let dir = path.join(os.homedir(), ".megacode");

/** Where megacode persists everything: ~/.megacode unless the entry point chose another folder. */
export const configDir = () => dir;

/** Points all persistence at another folder ($MEGACODE_CONFIG_DIR in the CLI, a temporary one in tests). */
export function setConfigDir(next: string) {
  dir = next;
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path.join(dir, file), "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJson(file: string, data: unknown, opts: { secret?: boolean } = {}) {
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const p = path.join(dir, file);
    writeFileSync(p, JSON.stringify(data, null, 2), { mode: opts.secret ? 0o600 : 0o644 });
    if (opts.secret) chmodSync(p, 0o600); // mode is ignored when the file already exists
  } catch {
    // persistence is a convenience; ignore write failures
  }
}
