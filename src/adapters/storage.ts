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
