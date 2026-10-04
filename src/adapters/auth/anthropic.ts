import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const NOT_INSTALLED = "The Anthropic CLI isn't installed. Install it with `brew install anthropics/tap/ant`, or paste an API key.";

const antConfigDir = () =>
  process.env.ANTHROPIC_CONFIG_DIR ??
  (process.platform === "win32" ? path.join(process.env.APPDATA ?? "", "Anthropic") : path.join(os.homedir(), ".config", "anthropic"));

/** True if `ant auth login` has stored credentials the Anthropic SDK will pick up. */
export function hasAntProfile(): boolean {
  const dir = path.join(antConfigDir(), "credentials");
  try {
    return existsSync(dir) && readdirSync(dir).some((f) => f.endsWith(".json"));
  } catch {
    return false;
  }
}

/**
 * Runs `ant auth login` (Anthropic CLI browser sign-in). The SDK reads the resulting profile,
 * so megacode stores nothing itself. Each line of the CLI's output goes to `onOutput`.
 */
export function loginAnthropicCLI(onOutput: (line: string) => void, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ant", ["auth", "login"], { stdio: ["ignore", "pipe", "pipe"], signal });
    const onData = (d: Buffer) => d.toString().split("\n").filter(Boolean).forEach(onOutput);
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", (e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") return reject(new Error(NOT_INSTALLED));
      reject(e.name === "AbortError" ? new Error("Sign-in cancelled") : e);
    });
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ant auth login exited with code ${code}`))));
  });
}
